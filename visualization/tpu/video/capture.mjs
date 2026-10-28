// Renders the zoom video from ../index.html on a virtual clock (choreography in curve.mjs).
// Usage: node capture.mjs [--out file.mp4] [--dsf 2] [--pre 2.6] [--stills 1.5,4.6] [--test]
// Needs Google Chrome, python3 (static server) and ffmpeg.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { zAt, orbitAt, FPS, DUR } from './curve.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TEST = process.argv.includes('--test'), STILLS = arg('--stills', ''), SIGN = +arg('--sign', 1);
const at = t => { const [a, e] = orbitAt(t, SIGN); return `tpu.go(${zAt(t)}); tpu.orbit(${a}, ${e})`; };
const FROM = +arg('--from', 0), TO = +arg('--to', DUR);   // render only part of the timeline (for checks)
const DSF = +arg('--dsf', 2), OUT = arg('--out', 'tpu-zoom-v2.mp4'), PRE = +arg('--pre', 5.05);
const SITE = new URL('..', import.meta.url).pathname, PORT = 8765, CDP = 9223;
const HERE = new URL('.', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', SITE], { stdio: 'ignore' });
const PROFILE = tmpdir() + '/tpu-capture-profile';
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--use-angle=metal', '--enable-gpu',
  '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

let target;
for (let i = 0; i < 100 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let mid = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') console.log('PAGE EXCEPTION', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) console.log('PAGE', m.params.type, m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: DSF, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(HERE + 'vt.js', 'utf8') });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
for (let i = 0; ; i++) {
  await sleep(250);
  try { if (await evaluate(`!!(window.tpu && window.__vt && window.tpuReady) && document.fonts.status === 'loaded'`)) break; } catch {}
  if (i > 120) throw new Error('page did not load');
}
await evaluate(`document.fonts.ready.then(() => true)`);
console.log('loaded:', await evaluate(`navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0] + ' · ' + (() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`));

// Pre-roll at the opening depth: compiles nothing visible, settles the HUD, and sets the systolic phase.
const STEP = 1000 / FPS;
await evaluate(`for (let i = 0; i < ${Math.round(PRE * FPS)}; i++) __vt.step(${STEP}, () => { ${at(0)} })`);

if (TEST) {
  // Freshness check: a frame captured right after a step must already show that step's depth.
  mkdirSync(HERE + 'test', { recursive: true });
  for (const z of [0, 5.3, 0]) { await evaluate(`__vt.step(${STEP}, () => tpu.go(${z}))`); writeFileSync(HERE + `test/fresh-${z}.png`, await shot()); }
  let t0 = performance.now();
  for (let i = 0; i < 20; i++) { await evaluate(`__vt.step(${STEP}, () => tpu.go(${zAt(i / FPS)}))`); await shot(); }
  console.log('ms per frame', ((performance.now() - t0) / 20).toFixed(0));
  cleanup(); process.exit(0);
}

const N = Math.round(DUR * FPS);
if (STILLS) {
  // Step through the whole timeline (same state as the real render) and grab selected frames.
  mkdirSync(HERE + 'stills', { recursive: true });
  const want = new Set(STILLS.split(',').map(x => Math.round(+x * FPS)));
  for (let i = 0; i < N; i++) {
    await evaluate(`__vt.step(${STEP}, () => { ${at(i / FPS)} })`);
    if (want.has(i)) writeFileSync(HERE + `stills/t${(i / FPS).toFixed(2)}${SIGN > 0 ? '+' : ''}.png`, await shot());
  }
  console.log('stills done'); cleanup(); process.exit(0);
}
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-vf', `scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,fade=t=in:st=0:d=0.5,fade=t=out:st=${DUR - 0.7}:d=0.7,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-r', String(FPS), '-movflags', '+faststart', '-an', HERE + OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise(r => ff.on('close', r));
const t0 = performance.now();
for (let i = 0; i < Math.round(TO * FPS); i++) {
  await evaluate(`__vt.step(${STEP}, () => { ${at(i / FPS)} })`);
  if (i < Math.round(FROM * FPS)) continue;
  const png = await shot();
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 120 === 0) console.log(`frame ${i}/${N}  z=${zAt(i / FPS).toFixed(2)}  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
console.log('ffmpeg exit', await done, 'total', ((performance.now() - t0) / 1000).toFixed(0), 's');
cleanup(); process.exit(0);
