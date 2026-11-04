# CPU Scheduling Simulator

An interactive, browser-based simulator for CPU scheduling algorithms. Each algorithm has its own simulation lab with tick-by-tick playback, live ready queues, an animated Gantt chart, an event log and complete metrics.

**Live demo:** https://cpu-scheduling-simulator-tharuniga.vercel.app

## Algorithms

| Type | Algorithms |
|------|------------|
| Non-preemptive | First Come First Serve (FCFS), Shortest Job First (SJF), Longest Job First (LJF), Priority, Highest Response Ratio Next (HRRN) |
| Preemptive | Shortest Remaining Time First (SRTF), Longest Remaining Time First (LRTF), Priority (Preemptive), Round Robin (RR) |
| Multi-queue | Multilevel Queue (MLQ), Multilevel Feedback Queue (MLFQ) |

## Features

- Home page listing every algorithm, filterable by type; each opens its own simulation page
- Editable process table (arrival, burst, priority, queue) with example and random workloads
- Playback controls: play/pause, step forward/back, scrub, speed, jump to result
- Live view of the CPU, ready queue(s) and process status at every time unit
- Animated Gantt chart with idle periods, and an event log of arrivals, dispatches, preemptions and completions
- Metrics: average waiting, turnaround and response time, throughput, CPU utilization, context switches
- Compare page that runs all algorithms on the same workload and ranks them

## Run locally

It is a static site with no build step:

```bash
npx serve .
```

Then open http://localhost:3000.

## Tech

HTML, CSS and vanilla JavaScript. The scheduling engine lives in `js/algorithms.js`; the UI and routing are in `js/app.js`.
