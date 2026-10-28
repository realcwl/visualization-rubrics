import { View } from './core/view.js';
import { makeProblem } from './core/problem.js';
import { buildTPU } from './tpu.js';
import { buildGPU } from './gpu.js';
import { HEX } from './core/palette.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  mode: 'split',
  t: 0,
  playing: true,
  speed: 1,
  size: { M: 256, N: 256, K: 256 },
  trails: true,
};

const keys = ['tpu', 'gpu'];
const els = {};
const views = {};
for (const k of keys) {
  const root = $(`#view-${k}`);
  els[k] = {
    root,
    head: $('.view-head', root),
    narr: $('[data-narr]', root),
    card: $('[data-code]', root),
    code: $('[data-code] .code-body', root),
    shots: $('[data-shots]', root),
    userCode: null, // explicit expand/collapse choice, overrides the per-mode default
  };
  $('.code-head', root).addEventListener('click', () => {
    els[k].userCode = els[k].card.classList.contains('collapsed');
    els[k].card.classList.toggle('collapsed', !els[k].userCode);
    updateInsets(k);
  });
  views[k] = new View($('.canvas-host', root));
  views[k].onPick = showInfo;
  views[k].onManual = () => {
    syncCamButton();
    markShot(k, null);
  };
  views[k].onResize = () => updateInsets(k);
}

// Frame the 3-D content inside whatever the floating UI leaves free. Wide views
// push content sideways (narration left, code right); narrow ones push it up.
function updateInsets(k, immediate = false) {
  const e = els[k];
  const view = views[k];
  if (!e || !view.w) return;
  const R = e.root.getBoundingClientRect();
  const dock = $('.dock').getBoundingClientRect();
  const head = e.head.getBoundingClientRect();
  const narr = e.narr.getBoundingClientRect();
  const card = e.card.getBoundingClientRect();
  const codeOn = !document.body.classList.contains('no-code');
  const wide = R.width >= 1100;
  const ins = { top: head.bottom - R.top + 8, bottom: R.bottom - dock.top + 14, left: 0, right: 0 };
  if (wide) {
    ins.left = narr.right - R.left + 10;
    if (codeOn && !e.card.classList.contains('collapsed')) ins.right = R.right - card.left + 10;
  } else {
    ins.bottom = Math.max(ins.bottom, R.bottom - narr.top + 10);
    if (codeOn) ins.top = Math.max(ins.top, card.bottom - R.top + 6);
  }
  // keep the frame balanced: never shift the content more than needed
  ins.left = Math.min(ins.left, R.width * 0.32);
  ins.right = Math.min(ins.right, R.width * 0.3);
  view.setInsets(ins, immediate);
}
function applyCodeDefaults() {
  for (const k of keys) {
    const e = els[k];
    const collapsed = e.userCode == null ? state.mode === 'split' : !e.userCode;
    e.card.classList.toggle('collapsed', collapsed);
  }
}
const sims = {};
const last = { tpu: { t: -1, mark: -1 }, gpu: { t: -1, mark: -1 } };

// ------------------------------------------------------------------ build / rebuild
function build() {
  const P = makeProblem(state.size.M, state.size.N, state.size.K);
  for (const k of keys) sims[k]?.dispose();
  sims.tpu = buildTPU(views.tpu, P);
  sims.gpu = buildGPU(views.gpu, P);
  for (const k of keys) {
    const sim = sims[k];
    sim.setTrails(state.trails);
    views[k].setShots(sim.shots);
    renderCode(k, sim.code);
    updateInsets(k, true);
    views[k].goTo('overview', true);
    renderShotButtons(k, sim);
    last[k] = { t: -1, mark: -1 };
  }
  $('#sizeText').textContent = `${state.size.M} × ${state.size.N} × ${state.size.K}`;
  state.t = 0;
  lanes.setData();
}

// ------------------------------------------------------------------ code panel
function highlight(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const hash = src.indexOf('#');
  let code = hash >= 0 ? src.slice(0, hash) : src;
  const cm = hash >= 0 ? src.slice(hash) : '';
  code = esc(code)
    .replace(/\b(for|in|range|zeros|runs|on)\b/g, '<span class="kw">$1</span>')
    .replace(/\b(dma|tma\.load|tma\.store|mxu\.load_weights|mxu\.push|mxu\.pop|wgmma\.m64n128k16|mbarrier\.wait|tiles|cta)\b/g, '<span class="fn">$1</span>')
    .replace(/\b(acc)\b/g, '<span class="op-C">$1</span>')
    .replace(/\bA(?=\[|,|\))/g, '<span class="op-A">A</span>')
    .replace(/\bB(?=\[|,|\))/g, '<span class="op-B">B</span>')
    .replace(/\bC(?=\[|\))/g, '<span class="op-C">C</span>')
    .replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
  return code + (cm ? `<span class="cm">${esc(cm)}</span>` : '');
}
function renderCode(k, lines) {
  els[k].code.innerHTML = lines.map((l, i) => `<div class="ln" data-n="${i + 1}">${highlight(l)}</div>`).join('');
}
function setCodeLine(k, line) {
  $$('.ln', els[k].code).forEach((el, i) => el.classList.toggle('on', i === line));
}

// ------------------------------------------------------------------ camera shots
function renderShotButtons(k, sim) {
  els[k].shots.innerHTML = sim.shotNames.map(([id, name]) => `<button data-shot="${id}">${name}</button>`).join('');
  $$('button', els[k].shots).forEach((b) =>
    b.addEventListener('click', () => {
      views[k].auto = false;
      views[k].goTo(b.dataset.shot);
      markShot(k, b.dataset.shot);
      syncCamButton();
    })
  );
}
function markShot(k, id) {
  $$('button', els[k].shots).forEach((b) => b.classList.toggle('on', b.dataset.shot === id));
}
function syncCamButton() {
  const on = visibleKeys().some((k) => views[k].auto);
  $('#btnCam').setAttribute('aria-pressed', String(on));
}

// ------------------------------------------------------------------ narration
function setNarration(k, sim, mi) {
  const m = sim.tl.marks[mi];
  const box = els[k].narr;
  box.classList.add('swap');
  clearTimeout(box._t);
  box._t = setTimeout(() => {
    $('.step', box).textContent = `Step ${mi + 1} / ${sim.tl.marks.length}`;
    $('h3', box).innerHTML = m.title;
    $('p', box).innerHTML = m.body;
    box.classList.remove('swap');
    updateInsets(k);
  }, 160);
  setCodeLine(k, m.line);
  if (views[k].auto) {
    views[k].goTo(m.shot);
    markShot(k, null);
  }
}

// ------------------------------------------------------------------ modes
function visibleKeys() {
  return state.mode === 'split' ? keys : [state.mode];
}
function setMode(mode) {
  state.mode = mode;
  $('#stage').className = mode;
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  moveInk();
  for (const k of keys) views[k].visible = visibleKeys().includes(k);
  applyCodeDefaults();
  $$('.lane-labels span').forEach((s) => s.classList.toggle('dim', !visibleKeys().includes(s.dataset.lane)));
  requestAnimationFrame(() =>
    keys.forEach((k) => {
      views[k].resize();
      updateInsets(k);
    })
  );
  lanes.draw();
}
function moveInk() {
  const on = $('#modeSeg button.on');
  const ink = $('#modeSeg .seg-ink');
  ink.style.left = `${on.offsetLeft}px`;
  ink.style.width = `${on.offsetWidth}px`;
}

// ------------------------------------------------------------------ dock lanes
const KIND = { dma: HEX.mem, store: HEX.C, weights: HEX.B, mxu: HEX.mxu, acc: HEX.vpu };
const lanes = {
  canvas: $('#laneCanvas'),
  tip: $('#laneTip'),
  wrap: $('.lane-wrap'),
  duration: 1,
  setData() {
    this.duration = Math.max(sims.tpu.tl.duration, sims.gpu.tl.duration) + 0.5;
    this.draw();
  },
  rows() {
    const h = this.wrap.clientHeight;
    return { tpu: 8, gpu: h / 2 + 6, laneH: h / 2 - 14 };
  },
  x(t) {
    return (t / this.duration) * this.wrap.clientWidth;
  },
  draw() {
    const c = this.canvas;
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio);
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!sims.tpu) return;
    const R = this.rows();
    for (const k of keys) {
      const sim = sims[k];
      const y0 = R[k];
      const vis = visibleKeys().includes(k);
      g.globalAlpha = vis ? 1 : 0.3;
      // track
      g.fillStyle = 'rgba(255,255,255,0.035)';
      round(g, 0, y0, w, R.laneH, 5);
      g.fill();
      const tEnd = Math.min(state.t, sim.tl.duration);
      for (const sp of sim.tl.spans) {
        const x0 = this.x(sp.start);
        const x1 = Math.max(x0 + 1.5, this.x(sp.end));
        const yy = sp.row === 'mem' ? y0 + 3 : y0 + R.laneH / 2 + 1;
        const hh = R.laneH / 2 - 4;
        const col = KIND[sp.kind] || HEX.mem;
        g.fillStyle = col;
        g.globalAlpha = (vis ? 1 : 0.3) * (sp.start <= tEnd ? 0.95 : 0.28);
        round(g, x0, yy, x1 - x0 - 1, hh, 2);
        g.fill();
      }
      g.globalAlpha = vis ? 1 : 0.3;
      g.fillStyle = 'rgba(232,238,248,0.55)';
      for (const m of sim.tl.marks) {
        const x = this.x(m.t);
        g.fillRect(x - 0.5, y0 - 4, 1, 3);
      }
      if (sim.tl.duration < this.duration - 0.6) {
        const xe = this.x(sim.tl.duration);
        g.fillStyle = 'rgba(232,238,248,0.25)';
        g.fillRect(xe, y0, 1, R.laneH);
      }
    }
    g.globalAlpha = 1;
    // playhead
    const px = this.x(state.t);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(160,205,255,0)');
    grad.addColorStop(0.15, 'rgba(160,205,255,1)');
    grad.addColorStop(0.85, 'rgba(160,205,255,1)');
    grad.addColorStop(1, 'rgba(160,205,255,0)');
    g.fillStyle = grad;
    g.fillRect(px - 1, 0, 2, h);
    g.shadowColor = 'rgba(124,185,255,0.9)';
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(px, h / 2, 4, 0, Math.PI * 2);
    g.fillStyle = '#d7e9ff';
    g.fill();
    g.shadowBlur = 0;
  },
  hover(e) {
    const rect = this.wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = (x / rect.width) * this.duration;
    const k = y < rect.height / 2 ? 'tpu' : 'gpu';
    const sim = sims[k];
    const sp = sim.tl.spans.filter((s) => t >= s.start && t <= s.end).sort((a, b) => (a.row === 'cmp') - (b.row === 'cmp'));
    const mi = sim.tl.markIndex(Math.min(t, sim.tl.duration));
    const what = sp.length ? sp.map((s) => s.label).join('  ·  ') : sim.tl.marks[mi].title.replace(/<[^>]+>/g, '');
    this.tip.innerHTML = `<small>${k.toUpperCase()} ${t.toFixed(1)}s</small>${what}`;
    this.tip.style.left = `${Math.max(120, Math.min(rect.width - 120, x))}px`;
    this.tip.classList.add('show');
  },
};
function round(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, Math.max(0, w), h, Math.min(r, w / 2, h / 2));
}
{
  let drag = false;
  const seek = (e) => {
    const rect = lanes.wrap.getBoundingClientRect();
    state.t = Math.max(0, Math.min(lanes.duration, ((e.clientX - rect.left) / rect.width) * lanes.duration));
  };
  lanes.wrap.addEventListener('pointerdown', (e) => {
    drag = true;
    lanes.wrap.setPointerCapture(e.pointerId);
    seek(e);
  });
  lanes.wrap.addEventListener('pointermove', (e) => {
    if (drag) seek(e);
    lanes.hover(e);
  });
  lanes.wrap.addEventListener('pointerup', () => (drag = false));
  lanes.wrap.addEventListener('pointerleave', () => lanes.tip.classList.remove('show'));
}

// ------------------------------------------------------------------ transport
function setPlaying(on) {
  if (on && state.t >= lanes.duration - 0.01) state.t = 0;
  state.playing = on;
  $('#btnPlay').classList.toggle('playing', on);
}
function allMarkTimes() {
  const ts = [];
  for (const k of visibleKeys()) for (const m of sims[k].tl.marks) ts.push(m.t);
  return ts.sort((a, b) => a - b);
}
function step(dir) {
  const ts = allMarkTimes();
  if (dir > 0) {
    const n = ts.find((x) => x > state.t + 0.05);
    if (n != null) state.t = n + 0.001;
  } else {
    const p = ts.filter((x) => x < state.t - 0.6).pop();
    state.t = p != null ? p + 0.001 : 0;
  }
}
$('#btnPlay').addEventListener('click', () => setPlaying(!state.playing));
$('#btnNext').addEventListener('click', () => step(1));
$('#btnPrev').addEventListener('click', () => step(-1));
$('#btnRestart').addEventListener('click', () => {
  state.t = 0;
  setPlaying(true);
});
$$('#speed button').forEach((b) =>
  b.addEventListener('click', () => {
    state.speed = +b.dataset.s;
    $$('#speed button').forEach((x) => x.classList.toggle('on', x === b));
  })
);
$$('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function toggleCam() {
  const on = !visibleKeys().some((k) => views[k].auto);
  for (const k of keys) {
    views[k].auto = on;
    if (on) {
      const sim = sims[k];
      const mi = sim.tl.markIndex(Math.min(state.t, sim.tl.duration));
      views[k].goTo(sim.tl.marks[mi].shot);
      markShot(k, null);
    }
  }
  syncCamButton();
}
function toggleBody(cls, btn) {
  const off = document.body.classList.toggle(cls);
  $(btn).setAttribute('aria-pressed', String(!off));
  keys.forEach((k) => updateInsets(k));
}
$('#btnCam').addEventListener('click', toggleCam);
$('#btnCode').addEventListener('click', () => toggleBody('no-code', '#btnCode'));
$('#btnLabels').addEventListener('click', () => toggleBody('no-labels', '#btnLabels'));

// settings
const pop = $('#settings');
$('#btnSettings').addEventListener('click', (e) => {
  e.stopPropagation();
  pop.hidden = !pop.hidden;
  $('#btnSettings').setAttribute('aria-pressed', String(!pop.hidden));
});
pop.addEventListener('click', (e) => e.stopPropagation());
$$('.seg.mini', pop).forEach((seg) =>
  $$('button', seg).forEach((b) =>
    b.addEventListener('click', () => {
      $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
      state.size[seg.dataset.dim] = +b.textContent;
      build();
      setPlaying(true);
    })
  )
);
$('#optTrails').addEventListener('change', (e) => {
  state.trails = e.target.checked;
  keys.forEach((k) => sims[k].setTrails(state.trails));
  keys.forEach((k) => (last[k].t = -1));
});
$('#optBloom').addEventListener('change', (e) => keys.forEach((k) => (views[k].bloom.enabled = e.target.checked)));

// ------------------------------------------------------------------ info card
const info = $('#info');
function showInfo(d, x, y) {
  if (!d) {
    info.hidden = true;
    return;
  }
  info.innerHTML = `
    <button class="x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <h4>${d.title}</h4>
    <div class="tag">${d.tag || ''}</div>
    ${d.analog ? `<span class="analog">${d.analog}</span>` : ''}
    ${d.specs ? `<table>${d.specs.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>` : ''}
    <p>${d.body || ''}</p>`;
  info.hidden = false;
  const w = 320;
  const h = info.offsetHeight;
  info.style.left = `${Math.min(window.innerWidth - w - 14, Math.max(14, x + 16))}px`;
  info.style.top = `${Math.min(window.innerHeight - h - 130, Math.max(70, y - 30))}px`;
  $('.x', info).addEventListener('click', () => (info.hidden = true));
}
document.addEventListener('click', () => {
  pop.hidden = true;
  $('#btnSettings').setAttribute('aria-pressed', 'false');
});

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === '1') setMode('tpu');
  else if (e.key === '2') setMode('split');
  else if (e.key === '3') setMode('gpu');
  else if (e.key === 'c' || e.key === 'C') toggleCam();
  else if (e.key === 'k' || e.key === 'K') toggleBody('no-code', '#btnCode');
  else if (e.key === 'l' || e.key === 'L') toggleBody('no-labels', '#btnLabels');
  else if (e.key === 'r' || e.key === 'R') state.t = 0;
  else if (e.key === 'Escape') info.hidden = true;
});

// ------------------------------------------------------------------ main loop
applyCodeDefaults();
build();
setMode('split');
setPlaying(true);
setTimeout(() => $('#hint').classList.add('gone'), 7000);
window.addEventListener('resize', () => {
  moveInk();
  lanes.draw();
});

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  if (state.playing) {
    state.t += dt * state.speed;
    if (state.t >= lanes.duration) {
      state.t = lanes.duration;
      setPlaying(false);
    }
  }
  for (const k of visibleKeys()) {
    const sim = sims[k];
    const tt = Math.min(state.t, sim.tl.duration);
    if (tt !== last[k].t) {
      sim.evaluate(tt);
      last[k].t = tt;
    }
    const mi = sim.tl.markIndex(tt);
    if (mi !== last[k].mark) {
      last[k].mark = mi;
      setNarration(k, sim, mi);
    }
    views[k].update(dt);
    views[k].render();
  }
  $('#clock').textContent = state.t.toFixed(1);
  lanes.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy for poking around from the console
window.__mm = { state, sims, views };
