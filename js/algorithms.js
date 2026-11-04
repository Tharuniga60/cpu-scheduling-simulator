/*
 * CPU scheduling engine.
 * Every algorithm is simulated one time unit at a time so the UI can replay
 * the exact state (running process, ready queues, events) at any instant.
 */
const Scheduler = (() => {
  const MAX_TIME = 5000;

  function prepare(procs) {
    return procs.map((p, i) => ({
      pid: p.pid,
      at: p.at,
      bt: p.bt,
      pr: p.pr,
      queue: p.queue,
      idx: i,
      rem: p.bt,
      start: null,
      ct: null,
      level: 0,
      used: 0,
    }));
  }

  // Collects Gantt segments; consecutive ticks of the same process merge
  // unless the process was freshly dispatched (e.g. RR re-dispatch).
  function recorder() {
    const segs = [];
    return {
      segs,
      push(pid, t, cont) {
        const last = segs[segs.length - 1];
        if (last && last.pid === pid && last.end === t && (cont || pid === null)) {
          last.end = t + 1;
        } else {
          segs.push({ pid, start: t, end: t + 1 });
        }
      },
    };
  }

  function eventLog() {
    const events = [];
    return {
      events,
      add(t, type, text) {
        events.push({ t, type, text });
      },
    };
  }

  function arrivals(ps) {
    return [...ps].sort((a, b) => a.at - b.at || a.idx - b.idx);
  }

  function finalize(ps, rec, timeline, log, end) {
    const rows = ps.map((p) => {
      const tat = p.ct - p.at;
      return {
        pid: p.pid,
        idx: p.idx,
        at: p.at,
        bt: p.bt,
        pr: p.pr,
        queue: p.queue,
        st: p.start,
        ct: p.ct,
        tat,
        wt: tat - p.bt,
        rt: p.start - p.at,
      };
    });
    const n = rows.length;
    const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / n;
    const minAt = Math.min(...rows.map((r) => r.at));
    const span = Math.max(1, end - minAt);
    const busy = rows.reduce((s, r) => s + r.bt, 0);
    const work = rec.segs.filter((s) => s.pid !== null);
    const switches = Math.max(0, work.length - 1);
    return {
      rows,
      segments: rec.segs,
      timeline,
      events: log.events,
      end,
      metrics: {
        avgWT: avg('wt'),
        avgTAT: avg('tat'),
        avgRT: avg('rt'),
        throughput: n / span,
        utilization: (busy / span) * 100,
        switches,
        makespan: end,
      },
    };
  }

  /* ---------- Pool based: FCFS, SJF, SRTF, LJF, LRTF, Priority, HRRN ---------- */
  function runPool(procs, { key, preemptive, label }) {
    const ps = prepare(procs);
    const n = ps.length;
    const order = arrivals(ps);
    const rec = recorder();
    const log = eventLog();
    const timeline = [];
    const ready = [];
    let ai = 0;
    let t = 0;
    let done = 0;
    let cur = null;

    const cmp = (a, b) => key(a, t) - key(b, t) || a.at - b.at || a.idx - b.idx;
    const addArrivals = () => {
      while (ai < n && order[ai].at <= t) {
        const p = order[ai++];
        ready.push(p);
        log.add(t, 'arrive', `${p.pid} arrives (burst ${p.bt}) and joins the ready queue`);
      }
    };

    addArrivals();
    while (done < n && t < MAX_TIME) {
      if (cur && preemptive && ready.length) {
        const best = [...ready].sort(cmp)[0];
        if (cmp(best, cur) < 0) {
          log.add(t, 'preempt', `${best.pid} preempts ${cur.pid} (${label(best, t)} vs ${label(cur, t)})`);
          ready.push(cur);
          cur = null;
        }
      }
      const cont = !!cur;
      if (!cur && ready.length) {
        ready.sort(cmp);
        cur = ready.shift();
        if (cur.start === null) cur.start = t;
        log.add(t, 'dispatch', `${cur.pid} is dispatched to the CPU (${label(cur, t)})`);
      }
      timeline.push({
        t,
        running: cur ? cur.pid : null,
        queues: [{ name: 'Ready Queue', items: [...ready].sort(cmp).map((p) => p.pid) }],
      });
      rec.push(cur ? cur.pid : null, t, cont);
      if (cur) cur.rem--;
      t++;
      addArrivals();
      if (cur && cur.rem === 0) {
        cur.ct = t;
        done++;
        log.add(t, 'complete', `${cur.pid} completes at t=${t}`);
        cur = null;
      }
    }
    return finalize(ps, rec, timeline, log, t);
  }

  /* ---------- Round Robin ---------- */
  function runRR(procs, { quantum }) {
    const q = Math.max(1, quantum | 0);
    const ps = prepare(procs);
    const n = ps.length;
    const order = arrivals(ps);
    const rec = recorder();
    const log = eventLog();
    const timeline = [];
    const ready = [];
    let ai = 0;
    let t = 0;
    let done = 0;
    let cur = null;
    let used = 0;

    const addArrivals = () => {
      while (ai < n && order[ai].at <= t) {
        const p = order[ai++];
        ready.push(p);
        log.add(t, 'arrive', `${p.pid} arrives (burst ${p.bt}) and joins the tail of the queue`);
      }
    };

    addArrivals();
    while (done < n && t < MAX_TIME) {
      const cont = !!cur;
      if (!cur && ready.length) {
        cur = ready.shift();
        used = 0;
        if (cur.start === null) cur.start = t;
        log.add(t, 'dispatch', `${cur.pid} gets the CPU for up to ${q} unit(s) (remaining ${cur.rem})`);
      }
      timeline.push({
        t,
        running: cur ? cur.pid : null,
        queues: [{ name: 'Ready Queue (FIFO)', items: ready.map((p) => p.pid) }],
      });
      rec.push(cur ? cur.pid : null, t, cont);
      if (cur) {
        cur.rem--;
        used++;
      }
      t++;
      addArrivals();
      if (cur) {
        if (cur.rem === 0) {
          cur.ct = t;
          done++;
          log.add(t, 'complete', `${cur.pid} completes at t=${t}`);
          cur = null;
        } else if (used === q) {
          ready.push(cur);
          log.add(t, 'preempt', `Time quantum expired — ${cur.pid} moves to the tail (remaining ${cur.rem})`);
          cur = null;
        }
      }
    }
    return finalize(ps, rec, timeline, log, t);
  }

  /* ---------- Multilevel Queue (Q1: RR system, Q2: FCFS user) ---------- */
  function runMLQ(procs, { quantum }) {
    const q = Math.max(1, quantum | 0);
    const ps = prepare(procs);
    const n = ps.length;
    const order = arrivals(ps);
    const rec = recorder();
    const log = eventLog();
    const timeline = [];
    const Q1 = [];
    const Q2 = [];
    let ai = 0;
    let t = 0;
    let done = 0;
    let cur = null;
    let used = 0;

    const addArrivals = () => {
      while (ai < n && order[ai].at <= t) {
        const p = order[ai++];
        if (p.queue === 1) Q1.push(p);
        else Q2.push(p);
        log.add(t, 'arrive', `${p.pid} arrives in ${p.queue === 1 ? 'Q1 (system, RR)' : 'Q2 (user, FCFS)'}`);
      }
    };

    addArrivals();
    while (done < n && t < MAX_TIME) {
      if (cur && cur.queue !== 1 && Q1.length) {
        log.add(t, 'preempt', `${Q1[0].pid} in Q1 preempts ${cur.pid} from Q2`);
        Q2.unshift(cur);
        cur = null;
      }
      const cont = !!cur;
      if (!cur) {
        if (Q1.length) {
          cur = Q1.shift();
          used = 0;
        } else if (Q2.length) {
          cur = Q2.shift();
        }
        if (cur) {
          if (cur.start === null) cur.start = t;
          log.add(t, 'dispatch', `${cur.pid} dispatched from ${cur.queue === 1 ? 'Q1' : 'Q2'}`);
        }
      }
      timeline.push({
        t,
        running: cur ? cur.pid : null,
        queues: [
          { name: 'Q1 · System (RR)', items: Q1.map((p) => p.pid) },
          { name: 'Q2 · User (FCFS)', items: Q2.map((p) => p.pid) },
        ],
      });
      rec.push(cur ? cur.pid : null, t, cont);
      if (cur) {
        cur.rem--;
        used++;
      }
      t++;
      addArrivals();
      if (cur) {
        if (cur.rem === 0) {
          cur.ct = t;
          done++;
          log.add(t, 'complete', `${cur.pid} completes at t=${t}`);
          cur = null;
        } else if (cur.queue === 1 && used === q) {
          Q1.push(cur);
          log.add(t, 'preempt', `Quantum expired — ${cur.pid} returns to the tail of Q1`);
          cur = null;
        }
      }
    }
    return finalize(ps, rec, timeline, log, t);
  }

  /* ---------- Multilevel Feedback Queue (Q0: RR q, Q1: RR 2q, Q2: FCFS) ---------- */
  function runMLFQ(procs, { quantum }) {
    const q = Math.max(1, quantum | 0);
    const quanta = [q, q * 2, Infinity];
    const names = [`Q0 · RR (q=${q})`, `Q1 · RR (q=${q * 2})`, 'Q2 · FCFS'];
    const ps = prepare(procs);
    const n = ps.length;
    const order = arrivals(ps);
    const rec = recorder();
    const log = eventLog();
    const timeline = [];
    const Qs = [[], [], []];
    let ai = 0;
    let t = 0;
    let done = 0;
    let cur = null;

    const addArrivals = () => {
      while (ai < n && order[ai].at <= t) {
        const p = order[ai++];
        Qs[0].push(p);
        log.add(t, 'arrive', `${p.pid} arrives and enters Q0`);
      }
    };

    addArrivals();
    while (done < n && t < MAX_TIME) {
      if (cur && Qs.slice(0, cur.level).some((x) => x.length)) {
        const lvl = Qs.findIndex((x) => x.length);
        log.add(t, 'preempt', `${Qs[lvl][0].pid} in Q${lvl} preempts ${cur.pid} (Q${cur.level})`);
        Qs[cur.level].unshift(cur);
        cur = null;
      }
      const cont = !!cur;
      if (!cur) {
        const lvl = Qs.findIndex((x) => x.length);
        if (lvl !== -1) {
          cur = Qs[lvl].shift();
          if (cur.start === null) cur.start = t;
          log.add(t, 'dispatch', `${cur.pid} dispatched from Q${lvl}`);
        }
      }
      timeline.push({
        t,
        running: cur ? cur.pid : null,
        level: cur ? cur.level : null,
        queues: Qs.map((x, i) => ({ name: names[i], items: x.map((p) => p.pid) })),
      });
      rec.push(cur ? cur.pid : null, t, cont);
      if (cur) {
        cur.rem--;
        cur.used++;
      }
      t++;
      addArrivals();
      if (cur) {
        if (cur.rem === 0) {
          cur.ct = t;
          done++;
          log.add(t, 'complete', `${cur.pid} completes at t=${t}`);
          cur = null;
        } else if (cur.level < 2 && cur.used === quanta[cur.level]) {
          cur.level++;
          cur.used = 0;
          Qs[cur.level].push(cur);
          log.add(t, 'demote', `${cur.pid} used its full quantum — demoted to Q${cur.level}`);
          cur = null;
        }
      }
    }
    return finalize(ps, rec, timeline, log, t);
  }

  const prSign = (opts) => (opts.lowerIsHigher === false ? -1 : 1);

  const list = [
    {
      id: 'fcfs',
      abbr: 'FCFS',
      name: 'First Come First Serve',
      category: 'non-preemptive',
      color: '#38bdf8',
      tagline: 'The simplest policy: whoever arrives first runs first.',
      steps: [
        'Processes are placed in the ready queue in order of arrival time.',
        'The process at the head of the queue gets the CPU.',
        'It runs until its entire burst is complete — no interruptions.',
        'The next process in arrival order is then dispatched.',
      ],
      pros: ['Very easy to implement', 'No starvation — every process eventually runs'],
      cons: ['Convoy effect: short jobs wait behind long ones', 'High average waiting time'],
      run: (p) => runPool(p, { key: (x) => x.at, preemptive: false, label: (x) => `arrival ${x.at}` }),
    },
    {
      id: 'sjf',
      abbr: 'SJF',
      name: 'Shortest Job First',
      category: 'non-preemptive',
      color: '#34d399',
      tagline: 'Pick the ready process with the smallest burst time.',
      steps: [
        'Whenever the CPU becomes free, look at every process that has arrived.',
        'Choose the one with the shortest burst time (ties broken by arrival).',
        'Run it to completion without preemption.',
        'Repeat until all processes finish.',
      ],
      pros: ['Optimal average waiting time among non-preemptive policies', 'Great for batch systems'],
      cons: ['Long jobs may starve', 'Requires knowing burst times in advance'],
      run: (p) => runPool(p, { key: (x) => x.bt, preemptive: false, label: (x) => `burst ${x.bt}` }),
    },
    {
      id: 'srtf',
      abbr: 'SRTF',
      name: 'Shortest Remaining Time First',
      category: 'preemptive',
      color: '#a3e635',
      tagline: 'Preemptive SJF — always run the job closest to finishing.',
      steps: [
        'At every time unit, compare the remaining time of all ready processes.',
        'The process with the least remaining time gets the CPU.',
        'If a newly arrived process needs less time than the running one, it preempts it.',
        'Preempted processes return to the ready queue with their remaining time.',
      ],
      pros: ['Minimum average waiting time overall', 'Very responsive to short jobs'],
      cons: ['Frequent context switches', 'Long processes can starve'],
      run: (p) =>
        runPool(p, { key: (x) => x.rem, preemptive: true, label: (x) => `remaining ${x.rem}` }),
    },
    {
      id: 'ljf',
      abbr: 'LJF',
      name: 'Longest Job First',
      category: 'non-preemptive',
      color: '#fbbf24',
      tagline: 'The opposite of SJF — the biggest burst goes first.',
      steps: [
        'When the CPU is free, examine all arrived processes.',
        'Select the process with the longest burst time.',
        'Run it to completion without preemption.',
        'Continue picking the longest remaining job.',
      ],
      pros: ['Long jobs never starve', 'Simple to reason about'],
      cons: ['Very high average waiting time', 'Short jobs suffer the convoy effect'],
      run: (p) => runPool(p, { key: (x) => -x.bt, preemptive: false, label: (x) => `burst ${x.bt}` }),
    },
    {
      id: 'lrtf',
      abbr: 'LRTF',
      name: 'Longest Remaining Time First',
      category: 'preemptive',
      color: '#fb923c',
      tagline: 'Preemptive LJF — the job with the most work left runs.',
      steps: [
        'At every time unit, find the ready process with the most remaining time.',
        'That process runs for one time unit.',
        'A process with more remaining time preempts the running one.',
        'Repeat until every process has completed.',
      ],
      pros: ['Balances progress across long jobs', 'No starvation of long jobs'],
      cons: ['Extremely high waiting and turnaround times', 'Many context switches'],
      run: (p) =>
        runPool(p, { key: (x) => -x.rem, preemptive: true, label: (x) => `remaining ${x.rem}` }),
    },
    {
      id: 'priority-np',
      abbr: 'PRI',
      name: 'Priority (Non-Preemptive)',
      category: 'non-preemptive',
      color: '#f472b6',
      needsPriority: true,
      tagline: 'Each process has a priority; the most important one runs next.',
      steps: [
        'Every process carries a priority number.',
        'When the CPU is free, the highest-priority ready process is chosen.',
        'It runs to completion even if a higher-priority process arrives.',
        'Ties are broken by arrival time.',
      ],
      pros: ['Lets critical tasks run first', 'Flexible — priorities can model anything'],
      cons: ['Low-priority processes can starve (fix: aging)', 'Priority inversion issues'],
      run: (p, o) =>
        runPool(p, {
          key: (x) => x.pr * prSign(o),
          preemptive: false,
          label: (x) => `priority ${x.pr}`,
        }),
    },
    {
      id: 'priority-p',
      abbr: 'PRI-P',
      name: 'Priority (Preemptive)',
      category: 'preemptive',
      color: '#e879f9',
      needsPriority: true,
      tagline: 'A higher-priority arrival immediately takes over the CPU.',
      steps: [
        'Every process carries a priority number.',
        'The highest-priority ready process always holds the CPU.',
        'If a higher-priority process arrives, the running one is preempted.',
        'Preempted processes resume later from where they stopped.',
      ],
      pros: ['Excellent responsiveness for important tasks', 'Used in real-time systems'],
      cons: ['Starvation of low-priority work', 'More context switching'],
      run: (p, o) =>
        runPool(p, {
          key: (x) => x.pr * prSign(o),
          preemptive: true,
          label: (x) => `priority ${x.pr}`,
        }),
    },
    {
      id: 'rr',
      abbr: 'RR',
      name: 'Round Robin',
      category: 'preemptive',
      color: '#818cf8',
      needsQuantum: true,
      tagline: 'Everyone gets a fair, fixed time slice in turn.',
      steps: [
        'Ready processes wait in a FIFO circular queue.',
        'The head of the queue runs for at most one time quantum.',
        'If it is not finished, it goes to the tail of the queue.',
        'New arrivals join the tail before the preempted process.',
      ],
      pros: ['Fair — no starvation', 'Good response time for interactive systems'],
      cons: ['Performance depends heavily on the quantum', 'Higher context-switch overhead'],
      run: (p, o) => runRR(p, { quantum: o.quantum }),
    },
    {
      id: 'hrrn',
      abbr: 'HRRN',
      name: 'Highest Response Ratio Next',
      category: 'non-preemptive',
      color: '#2dd4bf',
      tagline: 'Favors short jobs but ages waiting ones to prevent starvation.',
      steps: [
        'When the CPU is free, compute for each ready process: RR = (Waiting + Burst) / Burst.',
        'Select the process with the highest response ratio.',
        'Run it to completion without preemption.',
        'Waiting processes gain ratio over time, so none starves.',
      ],
      pros: ['Balances SJF efficiency with fairness', 'Prevents starvation through aging'],
      cons: ['Needs burst-time estimates', 'Ratio must be recomputed every decision'],
      run: (p) =>
        runPool(p, {
          key: (x, t) => -((t - x.at) + x.bt) / x.bt,
          preemptive: false,
          label: (x, t) => `ratio ${(((t - x.at) + x.bt) / x.bt).toFixed(2)}`,
        }),
    },
    {
      id: 'mlq',
      abbr: 'MLQ',
      name: 'Multilevel Queue',
      category: 'multi',
      color: '#f87171',
      needsQueue: true,
      needsQuantum: true,
      tagline: 'Separate queues for system and user processes, each with its own policy.',
      steps: [
        'Each process is permanently assigned to a queue: Q1 (system) or Q2 (user).',
        'Q1 is scheduled with Round Robin; Q2 is scheduled with FCFS.',
        'Q1 has absolute priority — Q2 runs only when Q1 is empty.',
        'A Q1 arrival preempts a running Q2 process, which resumes later.',
      ],
      pros: ['Different policies for different workloads', 'Low overhead scheduling'],
      cons: ['Inflexible — processes cannot move between queues', 'Q2 can starve'],
      run: (p, o) => runMLQ(p, { quantum: o.quantum }),
    },
    {
      id: 'mlfq',
      abbr: 'MLFQ',
      name: 'Multilevel Feedback Queue',
      category: 'multi',
      color: '#c084fc',
      needsQuantum: true,
      tagline: 'Processes move between queues based on how they use the CPU.',
      steps: [
        'Every new process enters the top queue Q0 (RR with quantum q).',
        'Using a full quantum demotes it: Q0 → Q1 (RR, 2q) → Q2 (FCFS).',
        'Higher queues always run first and preempt lower ones.',
        'A preempted process returns to the front of its queue, keeping its slice.',
      ],
      pros: ['Adapts to process behavior automatically', 'Favors short and interactive jobs'],
      cons: ['Complex to tune', 'CPU-bound jobs can starve in lower queues'],
      run: (p, o) => runMLFQ(p, { quantum: o.quantum }),
    },
  ];

  const byId = Object.fromEntries(list.map((a) => [a.id, a]));

  return { list, byId };
})();
