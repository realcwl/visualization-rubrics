// Virtual clock injected before the page runs. performance.now, Date.now, rAF, setTimeout and
// CSS transitions all advance only when __vt.step(ms) is called, so every video frame is exactly 1/FPS apart.
(() => {
  let vt = 0;
  const T0 = Date.now();
  performance.now = () => vt;
  Date.now = () => T0 + vt;
  let raf = new Map(), rid = 0;
  window.requestAnimationFrame = cb => { raf.set(++rid, cb); return rid; };
  window.cancelAnimationFrame = id => { raf.delete(id); };
  const timers = new Map(); let tid = 0;
  window.setTimeout = (cb, ms, ...args) => { const id = ++tid; timers.set(id, { at: vt + (+ms || 0), cb, args }); return id; };
  window.clearTimeout = id => { timers.delete(id); };
  function syncAnims() {
    for (const a of document.getAnimations()) {
      if (a.__s === undefined) { a.__s = vt; a.pause(); }
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0, t = vt - a.__s;
      if (t >= end) a.finish(); else a.currentTime = t;
    }
  }
  window.__vt = {
    get now() { return vt; },
    step(ms, before) {
      const end = vt + ms;
      for (;;) {
        let id = null, best = null;
        for (const [k, t] of timers) if (t.at <= end && (!best || t.at < best.at)) { id = k; best = t; }
        if (!best) break;
        timers.delete(id); vt = Math.max(vt, best.at);
        if (typeof best.cb === 'function') best.cb(...best.args);
      }
      vt = end;
      syncAnims();
      if (before) before();
      const q = raf; raf = new Map();
      for (const cb of q.values()) cb(vt);
      syncAnims();
    },
  };
})();
