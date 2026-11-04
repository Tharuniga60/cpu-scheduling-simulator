(() => {
  const app = document.getElementById('app');

  const PALETTE = [
    '#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185',
    '#2dd4bf', '#fb923c', '#60a5fa', '#a3e635', '#e879f9', '#facc15',
  ];
  const MAX_PROCS = 12;
  const STORE_KEY = 'schedsim:v1';
  const CATEGORIES = {
    'non-preemptive': 'Non-Preemptive',
    preemptive: 'Preemptive',
    multi: 'Multi-Queue',
  };
  const DEFAULT = {
    procs: [
      { at: 0, bt: 5, pr: 3, queue: 1 },
      { at: 1, bt: 3, pr: 1, queue: 2 },
      { at: 2, bt: 8, pr: 4, queue: 1 },
      { at: 3, bt: 6, pr: 2, queue: 2 },
      { at: 5, bt: 2, pr: 5, queue: 1 },
    ],
    quantum: 2,
    lowerIsHigher: true,
  };

  let state = load();
  let player = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.procs) && s.procs.length) return { ...clone(DEFAULT), ...s };
    } catch (e) {
      /* storage unavailable */
    }
    return clone(DEFAULT);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  const pidOf = (i) => `P${i + 1}`;
  const colorOf = (pid) => PALETTE[(parseInt(pid.slice(1), 10) - 1) % PALETTE.length];
  const fmt = (n, d = 2) => (Number.isInteger(n) ? String(n) : n.toFixed(d));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    end: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 5l9 7-9 7zM15 5h3v14h-3z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* Routing                                                             */
  /* ------------------------------------------------------------------ */
  function route() {
    stopPlayer();
    const parts = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
    const page = parts[0] || 'home';
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    if (page === 'algo' && Scheduler.byId[parts[1]]) renderSim(Scheduler.byId[parts[1]]);
    else if (page === 'compare') renderCompare();
    else renderHome();
    window.scrollTo(0, 0);
  }

  function stopPlayer() {
    if (player) {
      clearTimeout(player.timer);
      player = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Home                                                                */
  /* ------------------------------------------------------------------ */
  function needsText(a) {
    const n = ['Arrival', 'Burst'];
    if (a.needsPriority) n.push('Priority');
    if (a.needsQueue) n.push('Queue');
    if (a.needsQuantum) n.push('Quantum');
    return n.join(' · ');
  }

  function heroMock() {
    const segs = [
      ['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 6], ['P1', 6, 8], ['P4', 8, 10], ['P2', 10, 11], ['P3', 11, 13], ['P4', 13, 15],
    ];
    const total = 15;
    return `
      <div class="mock">
        <div class="mock-top"><span></span><span></span><span></span><em>round-robin.sim · q = 2</em></div>
        <div class="mock-body">
          <div class="mock-row">
            <div class="mock-cpu"><small>CPU</small><b>P2</b></div>
            <div class="mock-queue"><small>Ready queue</small>
              <div>${['P3', 'P1', 'P4'].map((p) => `<span class="qchip" style="--pc:${colorOf(p)}">${p}</span>`).join('')}</div>
            </div>
          </div>
          <div class="mock-gantt">
            ${segs
              .map(
                ([p, s, e], i) =>
                  `<div class="mseg" style="--pc:${colorOf(p)};left:${(s / total) * 100}%;width:${((e - s) / total) * 100}%;animation-delay:${i * 0.12}s">${p}</div>`
              )
              .join('')}
            <div class="mock-head"></div>
          </div>
          <div class="mock-axis"><span>0</span><span>5</span><span>10</span><span>15</span></div>
          <div class="mock-metrics">
            <div><small>Avg WT</small><b>4.75</b></div>
            <div><small>Avg TAT</small><b>8.50</b></div>
            <div><small>CPU</small><b>100%</b></div>
          </div>
        </div>
      </div>`;
  }

  function renderHome() {
    const cards = Scheduler.list
      .map(
        (a, i) => `
        <a class="card" href="#/algo/${a.id}" style="--c:${a.color};animation-delay:${i * 40}ms" data-cat="${a.category}">
          <div class="card-top">
            <span class="tile">${a.abbr}</span>
            <span class="badge badge-${a.category}">${CATEGORIES[a.category]}</span>
          </div>
          <h3>${a.name}</h3>
          <p>${a.tagline}</p>
          <div class="card-foot">
            <span class="needs">${needsText(a)}</span>
            <span class="go">Simulate ${ICONS.arrow}</span>
          </div>
        </a>`
      )
      .join('');

    const count = (c) => Scheduler.list.filter((a) => a.category === c).length;

    app.innerHTML = `
      <section class="hero">
        <div class="hero-text">
          <span class="eyebrow"><span class="pulse"></span> Operating Systems · Interactive Lab</span>
          <h1>See how the CPU <span class="grad">decides who runs next.</span></h1>
          <p class="lead">Pick a scheduling algorithm, enter your processes and watch the simulation unfold tick by tick —
            with live ready queues, an animated Gantt chart and every metric calculated for you.</p>
          <div class="hero-cta">
            <button class="btn btn-primary" data-scroll="#algos">Explore algorithms ${ICONS.arrow}</button>
            <a class="btn btn-ghost" href="#/compare">Compare all algorithms</a>
          </div>
          <div class="hero-stats">
            <div><b>${Scheduler.list.length}</b><span>Algorithms</span></div>
            <div><b>Step</b><span>by-step replay</span></div>
            <div><b>6</b><span>Live metrics</span></div>
          </div>
        </div>
        <div class="hero-visual">${heroMock()}</div>
      </section>

      <section id="algos" class="section">
        <div class="section-head">
          <h2>Choose an algorithm</h2>
          <p>Every algorithm has its own simulation lab. Select one to enter it.</p>
        </div>
        <div class="chips" role="group" aria-label="Filter algorithms">
          <button class="chip active" data-filter="all">All <span>${Scheduler.list.length}</span></button>
          ${Object.entries(CATEGORIES)
            .map(([k, v]) => `<button class="chip" data-filter="${k}">${v} <span>${count(k)}</span></button>`)
            .join('')}
        </div>
        <div class="cards">${cards}</div>
      </section>

      <section class="section glossary">
        <div class="section-head"><h2>Key terms</h2><p>The metrics every simulation reports.</p></div>
        <div class="terms">
          <div class="term"><b>AT</b><span>Arrival Time</span><p>When the process enters the ready queue.</p></div>
          <div class="term"><b>BT</b><span>Burst Time</span><p>CPU time the process needs to finish.</p></div>
          <div class="term"><b>CT</b><span>Completion Time</span><p>When the process finishes executing.</p></div>
          <div class="term"><b>TAT</b><span>Turnaround Time</span><p>CT − AT: total time spent in the system.</p></div>
          <div class="term"><b>WT</b><span>Waiting Time</span><p>TAT − BT: time spent waiting in queues.</p></div>
          <div class="term"><b>RT</b><span>Response Time</span><p>First CPU time − AT: delay before first run.</p></div>
        </div>
      </section>`;

    $('[data-scroll]').addEventListener('click', () => $('#algos').scrollIntoView({ behavior: 'smooth' }));
    $$('.chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
        const f = chip.dataset.filter;
        $$('.card').forEach((card) => card.classList.toggle('hidden', f !== 'all' && card.dataset.cat !== f));
      })
    );
  }

  /* ------------------------------------------------------------------ */
  /* Process editor (shared by simulator and compare pages)              */
  /* ------------------------------------------------------------------ */
  function editorHTML({ priority, queue, quantum, quantumLabel = 'Time quantum' }) {
    return `
      <div class="panel-head">
        <h2>Processes</h2>
        <div class="panel-actions">
          <button class="btn btn-sm btn-ghost" data-act="example">Example</button>
          <button class="btn btn-sm btn-ghost" data-act="random">Random</button>
          <button class="btn btn-sm btn-ghost" data-act="clear">Clear</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="proc-table">
          <thead><tr>
            <th>Process</th><th>Arrival</th><th>Burst</th>
            ${priority ? '<th>Priority</th>' : ''}
            ${queue ? '<th>Queue</th>' : ''}
            <th></th>
          </tr></thead>
          <tbody id="proc-body"></tbody>
        </table>
      </div>
      <button class="btn btn-dashed" data-act="add">+ Add process</button>
      <div class="options">
        ${quantum ? `<label class="field"><span>${quantumLabel}</span><input type="number" min="1" max="20" id="opt-quantum" value="${state.quantum}" /></label>` : ''}
        ${
          priority
            ? `<label class="field"><span>Priority rule</span>
                <select id="opt-prio">
                  <option value="low" ${state.lowerIsHigher ? 'selected' : ''}>Lower number = higher priority</option>
                  <option value="high" ${!state.lowerIsHigher ? 'selected' : ''}>Higher number = higher priority</option>
                </select></label>`
            : ''
        }
      </div>
      <p class="error" id="err" role="alert"></p>`;
  }

  function bindEditor(root, cols, onRun) {
    const body = $('#proc-body', root);

    const renderRows = () => {
      body.innerHTML = state.procs
        .map((p, i) => {
          const pid = pidOf(i);
          return `<tr>
            <td><span class="pid" style="--pc:${colorOf(pid)}">${pid}</span></td>
            <td><input type="number" min="0" max="999" data-i="${i}" data-k="at" value="${p.at}" aria-label="${pid} arrival time" /></td>
            <td><input type="number" min="1" max="99" data-i="${i}" data-k="bt" value="${p.bt}" aria-label="${pid} burst time" /></td>
            ${cols.priority ? `<td><input type="number" min="0" max="99" data-i="${i}" data-k="pr" value="${p.pr}" aria-label="${pid} priority" /></td>` : ''}
            ${
              cols.queue
                ? `<td><select data-i="${i}" data-k="queue" aria-label="${pid} queue">
                    <option value="1" ${p.queue === 1 ? 'selected' : ''}>Q1 · System</option>
                    <option value="2" ${p.queue !== 1 ? 'selected' : ''}>Q2 · User</option>
                  </select></td>`
                : ''
            }
            <td><button class="icon-btn" data-del="${i}" title="Remove ${pid}" ${state.procs.length <= 1 ? 'disabled' : ''}>${ICONS.trash}</button></td>
          </tr>`;
        })
        .join('');
      $('[data-act="add"]', root).disabled = state.procs.length >= MAX_PROCS;
    };

    body.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset.k) return;
      state.procs[+el.dataset.i][el.dataset.k] = el.value === '' ? '' : Number(el.value);
      save();
    });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      state.procs.splice(+btn.dataset.del, 1);
      save();
      renderRows();
    });

    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'add' && state.procs.length < MAX_PROCS) {
        const last = state.procs[state.procs.length - 1];
        state.procs.push({ at: last ? Number(last.at) + 1 || 0 : 0, bt: 4, pr: 1, queue: 1 });
      } else if (act === 'example') {
        state.procs = clone(DEFAULT.procs);
        state.quantum = DEFAULT.quantum;
        const q = $('#opt-quantum', root);
        if (q) q.value = state.quantum;
      } else if (act === 'random') {
        const n = Math.max(4, Math.min(state.procs.length, 7));
        const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
        state.procs = Array.from({ length: n }, (_, i) => ({
          at: i === 0 ? 0 : rnd(0, 10),
          bt: rnd(1, 9),
          pr: rnd(1, 9),
          queue: rnd(1, 2),
        }));
      } else if (act === 'clear') {
        state.procs = [{ at: 0, bt: 1, pr: 1, queue: 1 }];
      } else if (act === 'run') {
        onRun();
        return;
      } else {
        return;
      }
      save();
      renderRows();
    });

    const q = $('#opt-quantum', root);
    if (q)
      q.addEventListener('input', () => {
        state.quantum = Number(q.value);
        save();
      });
    const pr = $('#opt-prio', root);
    if (pr)
      pr.addEventListener('change', () => {
        state.lowerIsHigher = pr.value === 'low';
        save();
      });

    renderRows();
  }

  function validate(cols) {
    const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    for (let i = 0; i < state.procs.length; i++) {
      const p = state.procs[i];
      const pid = pidOf(i);
      if (!isInt(p.at, 0, 999)) return `${pid}: arrival time must be a whole number from 0 to 999.`;
      if (!isInt(p.bt, 1, 99)) return `${pid}: burst time must be a whole number from 1 to 99.`;
      if (cols.priority && !isInt(p.pr, 0, 99)) return `${pid}: priority must be a whole number from 0 to 99.`;
    }
    if (cols.quantum && !isInt(state.quantum, 1, 20)) return 'Time quantum must be a whole number from 1 to 20.';
    return '';
  }

  const inputProcs = () =>
    state.procs.map((p, i) => ({ pid: pidOf(i), at: p.at, bt: p.bt, pr: p.pr, queue: p.queue === 1 ? 1 : 2 }));
  const runOpts = () => ({ quantum: state.quantum, lowerIsHigher: state.lowerIsHigher });

  /* ------------------------------------------------------------------ */
  /* Simulator page                                                      */
  /* ------------------------------------------------------------------ */
  function renderSim(algo) {
    const cols = { priority: !!algo.needsPriority, queue: !!algo.needsQueue, quantum: !!algo.needsQuantum };
    const idx = Scheduler.list.indexOf(algo);
    const prev = Scheduler.list[(idx - 1 + Scheduler.list.length) % Scheduler.list.length];
    const next = Scheduler.list[(idx + 1) % Scheduler.list.length];
    const quantumLabel = algo.id === 'mlfq' ? 'Base quantum (Q0)' : algo.id === 'mlq' ? 'Q1 time quantum' : 'Time quantum';

    app.innerHTML = `
      <section class="sim-head" style="--c:${algo.color}">
        <a href="#/" class="back">← All algorithms</a>
        <div class="sim-title">
          <span class="tile tile-lg">${algo.abbr}</span>
          <div>
            <span class="badge badge-${algo.category}">${CATEGORIES[algo.category]}</span>
            <h1>${algo.name}</h1>
            <p class="lead">${algo.tagline}</p>
          </div>
        </div>
      </section>

      <section class="sim-grid" style="--c:${algo.color}">
        <div class="panel editor">
          ${editorHTML({ ...cols, quantumLabel })}
          <button class="btn btn-primary btn-run" data-act="run">${ICONS.play} Run simulation</button>
        </div>
        <aside class="panel theory">
          <h2>How it works</h2>
          <ol class="steps">${algo.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          <div class="proscons">
            <div class="pc pros"><h3>Advantages</h3><ul>${algo.pros.map((s) => `<li>${s}</li>`).join('')}</ul></div>
            <div class="pc cons"><h3>Limitations</h3><ul>${algo.cons.map((s) => `<li>${s}</li>`).join('')}</ul></div>
          </div>
          <div class="formula">
            <code>TAT = CT − AT</code><code>WT = TAT − BT</code><code>RT = Start − AT</code>
          </div>
        </aside>
      </section>

      <section id="results" class="results" style="--c:${algo.color}" hidden></section>

      <nav class="pager">
        <a href="#/algo/${prev.id}" style="--c:${prev.color}"><small>← Previous</small><b>${prev.name}</b></a>
        <a href="#/algo/${next.id}" style="--c:${next.color}"><small>Next →</small><b>${next.name}</b></a>
      </nav>`;

    const editor = $('.editor');
    bindEditor(editor, cols, () => {
      const err = validate(cols);
      $('#err').textContent = err;
      if (err) return;
      const result = algo.run(inputProcs(), runOpts());
      showResults(result);
    });
  }

  function showResults(res) {
    stopPlayer();
    const box = $('#results');
    box.hidden = false;
    const T = res.end;
    const unit = T > 60 ? 18 : T > 30 ? 28 : 40;

    box.innerHTML = `
      <div class="panel player">
        <div class="player-bar">
          <div class="controls">
            <button class="ctl" data-p="reset" title="Restart">${ICONS.reset}</button>
            <button class="ctl" data-p="back" title="Step back">${ICONS.back}</button>
            <button class="ctl ctl-main" data-p="toggle" title="Play / pause">${ICONS.pause}</button>
            <button class="ctl" data-p="fwd" title="Step forward">${ICONS.fwd}</button>
            <button class="ctl" data-p="end" title="Jump to result">${ICONS.end}</button>
          </div>
          <input type="range" class="scrub" min="0" max="${T}" value="0" aria-label="Simulation time" />
          <label class="speed"><span>Speed</span>
            <select id="speed">
              <option value="0.5">0.5×</option><option value="1" selected>1×</option>
              <option value="2">2×</option><option value="4">4×</option>
            </select>
          </label>
        </div>

        <div class="live">
          <div class="clock"><small>Time</small><b id="clock">0</b><span>/ ${T}</span></div>
          <div class="cpu"><small>CPU</small><div class="cpu-core" id="cpu"></div></div>
          <div class="queues" id="queues"></div>
        </div>

        <div class="gantt-title"><h3>Gantt Chart</h3><span class="legend"><i class="idle-sw"></i> Idle</span></div>
        <div class="gantt-wrap">
          <div class="gantt" style="min-width:${T * unit}px">
            <div class="gantt-track" id="track"></div>
            <div class="gantt-axis" id="axis"></div>
          </div>
        </div>

        <div class="log-wrap">
          <h3>Event log</h3>
          <ul class="log" id="log"></ul>
        </div>
      </div>

      <div class="metrics" id="metrics"></div>

      <div class="panel">
        <div class="panel-head"><h2>Process table</h2></div>
        <div class="table-wrap"><table class="result-table" id="rtable"></table></div>
      </div>`;

    const bounds = new Set([0, T]);
    res.segments.forEach((s) => {
      bounds.add(s.start);
      bounds.add(s.end);
    });
    const marks = [...bounds].sort((a, b) => a - b);

    const hasPr = res.rows.some((r) => r.pr !== undefined) && $('#opt-prio');
    const hasQ = !!$('select[data-k="queue"]');

    player = { frame: 0, playing: true, timer: null, speed: 1 };

    const draw = () => {
      const f = player.frame;
      const snap = f < T ? res.timeline[f] : null;
      $('#clock').textContent = f;
      $('.scrub').value = f;

      const cpu = $('#cpu');
      if (f >= T) {
        cpu.className = 'cpu-core done';
        cpu.style.removeProperty('--pc');
        cpu.innerHTML = '<b>✓</b><span>All done</span>';
      } else if (snap.running) {
        cpu.className = 'cpu-core busy';
        cpu.style.setProperty('--pc', colorOf(snap.running));
        cpu.innerHTML = `<b>${snap.running}</b><span>${snap.level !== undefined && snap.level !== null ? `from Q${snap.level}` : 'running'}</span>`;
      } else {
        cpu.className = 'cpu-core';
        cpu.style.removeProperty('--pc');
        cpu.innerHTML = '<b>—</b><span>Idle</span>';
      }

      const queues = snap ? snap.queues : res.timeline[T - 1].queues.map((q) => ({ ...q, items: [] }));
      $('#queues').innerHTML = queues
        .map(
          (q) => `<div class="queue"><small>${q.name}</small><div class="qrow">${
            q.items.length
              ? q.items.map((p) => `<span class="qchip" style="--pc:${colorOf(p)}">${p}</span>`).join('')
              : '<span class="qempty">empty</span>'
          }</div></div>`
        )
        .join('');

      $('#track').innerHTML =
        res.segments
          .filter((s) => s.start < f)
          .map((s) => {
            const e = Math.min(s.end, f);
            const style = `left:${(s.start / T) * 100}%;width:${((e - s.start) / T) * 100}%`;
            if (s.pid === null) return `<div class="seg idle" style="${style}" title="Idle: ${s.start} → ${s.end}"></div>`;
            return `<div class="seg" style="${style};--pc:${colorOf(s.pid)}" title="${s.pid}: ${s.start} → ${s.end}"><span>${s.pid}</span></div>`;
          })
          .join('') + `<div class="playhead" style="left:${(f / T) * 100}%"></div>`;

      $('#axis').innerHTML = marks
        .filter((m) => m <= f)
        .map((m) => `<span style="left:${(m / T) * 100}%">${m}</span>`)
        .join('');

      const ev = res.events.filter((e) => e.t <= f).slice(-40).reverse();
      $('#log').innerHTML = ev.length
        ? ev
            .map(
              (e) =>
                `<li class="ev ev-${e.type} ${e.t === f ? 'now' : ''}"><span class="ev-t">t=${e.t}</span>${e.text}</li>`
            )
            .join('')
        : '<li class="ev muted">Press play to start the simulation.</li>';

      const m = res.metrics;
      const finished = f >= T;
      const card = (label, value, hint) =>
        `<div class="metric ${finished ? 'ready' : ''}"><small>${label}</small><b>${finished ? value : '—'}</b><span>${hint}</span></div>`;
      $('#metrics').innerHTML = [
        card('Avg Waiting Time', fmt(m.avgWT), 'units'),
        card('Avg Turnaround', fmt(m.avgTAT), 'units'),
        card('Avg Response', fmt(m.avgRT), 'units'),
        card('Throughput', fmt(m.throughput, 3), 'processes / unit'),
        card('CPU Utilization', `${fmt(m.utilization, 1)}%`, 'busy time'),
        card('Context Switches', m.switches, 'dispatch changes'),
      ].join('');

      const rows = res.rows
        .map((r) => {
          const done = r.ct <= f;
          let status;
          if (done) status = '<span class="st st-done">Done</span>';
          else if (snap && snap.running === r.pid) status = '<span class="st st-run">Running</span>';
          else if (r.at <= f) status = '<span class="st st-wait">Waiting</span>';
          else status = '<span class="st">Not arrived</span>';
          const v = (x) => (done ? x : '—');
          return `<tr class="${done ? 'done' : ''}">
            <td><span class="pid" style="--pc:${colorOf(r.pid)}">${r.pid}</span></td>
            <td>${r.at}</td><td>${r.bt}</td>
            ${hasPr ? `<td>${r.pr}</td>` : ''}
            ${hasQ ? `<td>Q${r.queue}</td>` : ''}
            <td>${v(r.ct)}</td><td>${v(r.tat)}</td><td>${v(r.wt)}</td><td>${v(r.rt)}</td>
            <td>${status}</td>
          </tr>`;
        })
        .join('');
      const avgRow = finished
        ? `<tr class="avg"><td colspan="${3 + (hasPr ? 1 : 0) + (hasQ ? 1 : 0)}">Average</td>
            <td>—</td><td>${fmt(m.avgTAT)}</td><td>${fmt(m.avgWT)}</td><td>${fmt(m.avgRT)}</td><td></td></tr>`
        : '';
      $('#rtable').innerHTML = `
        <thead><tr><th>Process</th><th>AT</th><th>BT</th>${hasPr ? '<th>Priority</th>' : ''}${hasQ ? '<th>Queue</th>' : ''}
          <th>CT</th><th>TAT</th><th>WT</th><th>RT</th><th>Status</th></tr></thead>
        <tbody>${rows}${avgRow}</tbody>`;

      $('[data-p="toggle"]').innerHTML = player.playing ? ICONS.pause : ICONS.play;
    };

    const tick = () => {
      if (!player) return;
      clearTimeout(player.timer);
      if (!player.playing) return;
      if (player.frame >= T) {
        player.playing = false;
        draw();
        return;
      }
      player.timer = setTimeout(() => {
        if (!player) return;
        player.frame++;
        draw();
        tick();
      }, 650 / player.speed);
    };

    const setFrame = (f, keepPlaying = false) => {
      player.frame = Math.max(0, Math.min(T, f));
      if (!keepPlaying) player.playing = false;
      draw();
      tick();
    };

    $('.player-bar').addEventListener('click', (e) => {
      const act = e.target.closest('[data-p]')?.dataset.p;
      if (!act) return;
      if (act === 'toggle') {
        if (player.frame >= T) player.frame = 0;
        player.playing = !player.playing;
        draw();
        tick();
      } else if (act === 'reset') setFrame(0, true);
      else if (act === 'back') setFrame(player.frame - 1);
      else if (act === 'fwd') setFrame(player.frame + 1);
      else if (act === 'end') setFrame(T);
    });
    $('.scrub').addEventListener('input', (e) => setFrame(Number(e.target.value)));
    $('#speed').addEventListener('change', (e) => {
      player.speed = Number(e.target.value);
      tick();
    });

    draw();
    tick();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------------ */
  /* Compare page                                                        */
  /* ------------------------------------------------------------------ */
  function renderCompare() {
    const cols = { priority: true, queue: true, quantum: true };
    app.innerHTML = `
      <section class="sim-head" style="--c:#a78bfa">
        <a href="#/" class="back">← All algorithms</a>
        <div class="sim-title">
          <span class="tile tile-lg">VS</span>
          <div>
            <span class="badge badge-multi">All ${Scheduler.list.length} algorithms</span>
            <h1>Compare Algorithms</h1>
            <p class="lead">Run every algorithm on the same workload and see which one performs best.</p>
          </div>
        </div>
      </section>
      <section class="compare-grid" style="--c:#a78bfa">
        <div class="panel editor">
          ${editorHTML({ ...cols, quantumLabel: 'Time quantum (RR / MLQ / MLFQ)' })}
          <p class="hint">Priority is used by the Priority algorithms; Queue is used by Multilevel Queue.</p>
          <button class="btn btn-primary btn-run" data-act="run">${ICONS.play} Compare all</button>
        </div>
      </section>
      <section id="cmp-results" class="results" hidden></section>`;

    bindEditor($('.editor'), cols, () => {
      const err = validate(cols);
      $('#err').textContent = err;
      if (err) return;
      const procs = inputProcs();
      const results = Scheduler.list.map((a) => ({ algo: a, res: a.run(procs, runOpts()) }));
      showCompare(results);
    });
  }

  function showCompare(results) {
    const box = $('#cmp-results');
    box.hidden = false;
    const maxEnd = Math.max(...results.map((r) => r.res.end));
    const best = (k, dir = 1) => Math.min(...results.map((r) => dir * r.res.metrics[k])) * dir;
    const bWT = best('avgWT');
    const bTAT = best('avgTAT');
    const bRT = best('avgRT');
    const bSW = best('switches');
    const sorted = [...results].sort((a, b) => a.res.metrics.avgWT - b.res.metrics.avgWT);
    const winner = sorted[0];

    const bars = (key, label) => {
      const max = Math.max(...results.map((r) => r.res.metrics[key])) || 1;
      return `<div class="panel bars">
        <h3>${label}</h3>
        ${[...results]
          .sort((a, b) => a.res.metrics[key] - b.res.metrics[key])
          .map(
            ({ algo, res }) => `<div class="bar-row" style="--c:${algo.color}">
              <span class="bar-label">${algo.abbr}</span>
              <div class="bar"><i style="width:${(res.metrics[key] / max) * 100}%"></i></div>
              <b>${fmt(res.metrics[key])}</b>
            </div>`
          )
          .join('')}
      </div>`;
    };

    const hi = (v, b) => (Math.abs(v - b) < 1e-9 ? 'best' : '');

    box.innerHTML = `
      <div class="winner panel" style="--c:${winner.algo.color}">
        <span class="tile">${winner.algo.abbr}</span>
        <div><small>Lowest average waiting time</small><h2>${winner.algo.name}</h2>
          <p>Average waiting time ${fmt(winner.res.metrics.avgWT)} · turnaround ${fmt(winner.res.metrics.avgTAT)}</p></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Results</h2><span class="muted">Sorted by average waiting time · best values highlighted</span></div>
        <div class="table-wrap">
          <table class="result-table cmp-table">
            <thead><tr><th>#</th><th>Algorithm</th><th>Avg WT</th><th>Avg TAT</th><th>Avg RT</th><th>Throughput</th><th>CPU %</th><th>Switches</th><th></th></tr></thead>
            <tbody>
              ${sorted
                .map(
                  ({ algo, res }, i) => `<tr>
                    <td>${i + 1}</td>
                    <td><span class="algo-name" style="--c:${algo.color}"><i></i>${algo.name}</span></td>
                    <td class="${hi(res.metrics.avgWT, bWT)}">${fmt(res.metrics.avgWT)}</td>
                    <td class="${hi(res.metrics.avgTAT, bTAT)}">${fmt(res.metrics.avgTAT)}</td>
                    <td class="${hi(res.metrics.avgRT, bRT)}">${fmt(res.metrics.avgRT)}</td>
                    <td>${fmt(res.metrics.throughput, 3)}</td>
                    <td>${fmt(res.metrics.utilization, 1)}</td>
                    <td class="${hi(res.metrics.switches, bSW)}">${res.metrics.switches}</td>
                    <td><a class="link" href="#/algo/${algo.id}">Simulate →</a></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="bars-grid">${bars('avgWT', 'Average waiting time')}${bars('avgTAT', 'Average turnaround time')}</div>
      <div class="panel">
        <div class="panel-head"><h2>Gantt charts</h2><span class="muted">Same time scale (0 – ${maxEnd})</span></div>
        <div class="mini-gantts">
          ${results
            .map(
              ({ algo, res }) => `<a class="mini" href="#/algo/${algo.id}" style="--c:${algo.color}">
                <span class="mini-label">${algo.abbr}</span>
                <div class="mini-track">${res.segments
                  .map((s) => {
                    const style = `left:${(s.start / maxEnd) * 100}%;width:${((s.end - s.start) / maxEnd) * 100}%`;
                    return s.pid === null
                      ? `<div class="seg idle" style="${style}"></div>`
                      : `<div class="seg" style="${style};--pc:${colorOf(s.pid)}" title="${s.pid}: ${s.start} → ${s.end}"><span>${s.pid}</span></div>`;
                  })
                  .join('')}</div>
              </a>`
            )
            .join('')}
        </div>
      </div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.addEventListener('hashchange', route);
  route();
})();
