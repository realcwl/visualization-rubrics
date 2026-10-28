/**
 * A seekable timeline. Every frame the scene is reset to its base state and every
 * segment that has started is re-applied in start order with p ∈ [0, 1]. Segments
 * must therefore be pure functions of (p, t): finished segments (p = 1) leave
 * their persistent effect (a filled buffer, a loaded weight) and draw no
 * particles. That makes scrubbing backwards and stepping trivially correct.
 */
export class Timeline {
  constructor() {
    this.segs = [];
    this.marks = [];
    this.spans = [];
    this.duration = 0;
  }
  add(start, dur, fn) {
    this.segs.push({ start, dur: Math.max(dur, 1e-6), fn });
    this.duration = Math.max(this.duration, start + dur);
  }
  /** A narrated step: { title, body, line, shot }. */
  mark(t, m) {
    this.marks.push({ t, ...m });
  }
  /** A colored bar on the dock lane. row: 'mem' | 'cmp'. */
  span(start, end, row, kind, label) {
    this.spans.push({ start, end, row, kind, label });
  }
  done() {
    this.segs.sort((a, b) => a.start - b.start);
    this.marks.sort((a, b) => a.t - b.t);
    for (const m of this.marks) this.duration = Math.max(this.duration, m.t);
  }
  apply(t) {
    for (const s of this.segs) {
      if (s.start > t) break;
      s.fn(Math.min(1, (t - s.start) / s.dur), t);
    }
  }
  markIndex(t) {
    let i = 0;
    for (let k = 0; k < this.marks.length; k++) {
      if (this.marks[k].t <= t + 1e-4) i = k;
      else break;
    }
    return i;
  }
}
