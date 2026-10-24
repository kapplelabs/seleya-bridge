/**
 * Time source for everything that waits: tailers, stall detection, time limits. Production uses the
 * real clock; tests use `FakeClock` and advance it explicitly, so no test sleeps.
 */
export interface Timer {
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  setInterval(fn: () => void, ms: number): Timer;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(handle) };
  },
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    return { cancel: () => clearInterval(handle) };
  },
};

interface Scheduled {
  id: number;
  at: number;
  every?: number;
  fn: () => void;
}

/** A clock that only moves when the test calls `advance`; due timers run in time order. */
export class FakeClock implements Clock {
  private time: number;
  private next = 1;
  private timers: Scheduled[] = [];

  constructor(start = 1_800_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): Timer {
    return this.add({ id: this.next++, at: this.time + ms, fn });
  }

  setInterval(fn: () => void, ms: number): Timer {
    return this.add({ id: this.next++, at: this.time + ms, every: ms, fn });
  }

  /** Moves time forward, running every timer that falls due on the way. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.time = due.at;
      if (due.every) due.at += due.every;
      else this.timers = this.timers.filter((timer) => timer !== due);
      due.fn();
    }
    this.time = end;
  }

  private add(timer: Scheduled): Timer {
    this.timers.push(timer);
    return { cancel: () => (this.timers = this.timers.filter((item) => item !== timer)) };
  }
}
