// Вектор-06Ц в браузере: ядро v06x (v06x.wasm), винчестер с Gobliiins, PCM ComboLite, мышь KTSerg
import { KEYMAP } from './keys.js';

const BUILD = document.documentElement.dataset.build || 'dev';
const $ = (id) => document.getElementById(id);
const screen = $('screen'), ctx = screen.getContext('2d');
const statusEl = $('status');
const say = (t) => { statusEl.textContent = t; };

const RATE = 48000, PER_FRAME = RATE / 50;     // звук ядра: 48 кГц, кадр 1/50 с

let M, W, H, BORDER, img, pix;
let running = false, paused = false, frames = 0;

async function fetchBytes(url, label) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(label + ': ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  const rd = r.body.getReader(); const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) say(label + ': ' + Math.round(100 * got / total) + '%');
  }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function put(bytes) {
  const p = M._malloc(bytes.length); M.HEAPU8.set(bytes, p); return p;
}

// ---- звук: AudioWorklet с кольцом; кадры эмулятора гонит заполнение кольца ----
let actx = null, node = null, queued = 0, volume = 1, audioAlive = 0;
const WORKLET = `
class Ring extends AudioWorkletProcessor {
  constructor() { super(); this.q = []; this.o = 0; this.n = 0;
    this.port.onmessage = (e) => { this.q.push(e.data); this.n += e.data.length / 2; }; }
  process(_, out) {
    const L = out[0][0], R = out[0][1]; let i = 0;
    while (i < L.length && this.q.length) {
      const b = this.q[0];
      while (i < L.length && this.o < b.length) { L[i] = b[this.o++]; R[i] = b[this.o++]; i++; }
      if (this.o >= b.length) { this.q.shift(); this.o = 0; }
    }
    this.n -= i;
    for (; i < L.length; i++) { L[i] = 0; R[i] = 0; }
    this.port.postMessage(this.n);
    return true;
  }
}
registerProcessor('ring', Ring);`;

async function startAudio() {
  if (actx) { if (actx.state !== 'running') await actx.resume(); return; }
  actx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await actx.audioWorklet.addModule(url);
  node = new AudioWorkletNode(actx, 'ring', { outputChannelCount: [2] });
  node.port.onmessage = (e) => { queued = e.data; audioAlive = performance.now(); };
  const g = actx.createGain(); g.gain.value = volume; node.connect(g).connect(actx.destination);
  node._gain = g;
  say('');
}

// ---- кадр ----
function frame() {
  frames++;
  const p = M._v_frame();
  pix.set(M.HEAPU8.subarray(p, p + W * H * 4));
  const a = M._v_audio(PER_FRAME) >> 2;
  if (node && actx.state === 'running') {
    node.port.postMessage(M.HEAPF32.slice(a, a + PER_FRAME * 2));
    queued += PER_FRAME;
  }
}

let last = 0, acc = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (!running || paused) { last = t; return; }
  let n = 0;
  // темп — по часам страницы (кадр 20 мс); звук подтягивает: мало в кольце — кадр лишний, много — пропуск
  acc += Math.min(200, t - (last || t));
  const audioOn = node && actx.state === 'running' && audioAlive > performance.now() - 500;
  if (audioOn && queued > PER_FRAME * 6) acc -= 2;
  if (audioOn && queued < PER_FRAME * 2) acc += 2;
  while (acc >= 20 && n < 6) { frame(); acc -= 20; n++; }
  if (acc > 100) acc = 0;
  last = t;
  if (n) {
    ctx.putImageData(img, 0, 0);
    $('ruslat').classList.toggle('on', !!M._v_ruslat());
    screen.classList.toggle('mouse', !!M._v_mouse_enabled());
  }
}

// ---- клавиатура ----
const held = new Set();
function key(e, down) {
  if (!running) return;
  const c = KEYMAP[e.code];
  if (c === undefined) return;
  if (e.metaKey && e.code !== 'MetaLeft' && e.code !== 'MetaRight') return;   // Cmd+... — браузеру
  e.preventDefault();
  startAudio();
  if (down) { if (held.has(e.code)) return; held.add(e.code); } else held.delete(e.code);
  M._v_key(c, down ? 1 : 0);
}
window.addEventListener('keydown', (e) => key(e, true));
window.addEventListener('keyup', (e) => key(e, false));
window.addEventListener('blur', () => { for (const c of held) M._v_key(KEYMAP[c], 0); held.clear(); });

// ---- мышь: координаты холста -> точки Вектора (x 0..511, y 0..255 снизу) ----
let mb = 0;
function mouse(e, wheel = 0) {
  if (!running) return;
  const r = screen.getBoundingClientRect();
  const tx = (e.clientX - r.left) * W / r.width, ty = (e.clientY - r.top) * H / r.height;
  const x = Math.floor(tx - BORDER), row = Math.floor(ty + (312 - H) - 40);
  const inside = x >= 0 && x < 512 && row >= 0 && row < 256;
  M._v_mouse(x, 255 - row, mb, wheel, inside ? 1 : 0);
}
screen.addEventListener('mousemove', (e) => mouse(e));
screen.addEventListener('mousedown', (e) => { startAudio(); screen.focus(); mb |= [1, 4, 2][e.button] || 0; mouse(e); e.preventDefault(); });
window.addEventListener('mouseup', (e) => { mb &= ~([1, 4, 2][e.button] || 0); mouse(e); });
screen.addEventListener('contextmenu', (e) => e.preventDefault());
screen.addEventListener('wheel', (e) => { mouse(e, Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });

// ---- набор с клавиатуры Вектора (запуск игры из CO) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFrames(n) { const f0 = frames; while (frames - f0 < n) await sleep(10); }
async function tap(code, hold = 8) { M._v_key(KEYMAP[code], 1); await waitFrames(hold); M._v_key(KEYMAP[code], 0); await waitFrames(8); }

// ---- запуск ----
async function boot() {
  say('Загрузка эмулятора…');
  M = await V06X({ locateFile: (f) => f + '?v=' + BUILD });
  M._v_init();
  W = M._v_width(); H = M._v_height(); BORDER = M._v_border();
  screen.width = W; screen.height = H;
  img = ctx.createImageData(W, H); pix = img.data;
  const [rom, hdd] = await Promise.all([
    fetchBytes('data/os-t72h.rom?v=' + BUILD, 'Система'),
    fetchBytes('data/gob.hdd?v=' + BUILD, 'Винчестер'),
  ]);
  M.FS.writeFile('/gob.hdd', hdd);
  if (!M.ccall('v_attach_hdd', 'number', ['string'], ['/gob.hdd'])) throw new Error('винчестер не подключился');
  const p = put(rom); M._v_load_rom(p, rom.length, 0x100); M._free(p);
  M._v_reset(0);
  running = true;
  requestAnimationFrame(loop);
  say('Загружается система T-72…');
  await waitFrames(200);
  for (const c of ['Tab', 'KeyG', 'KeyO', 'KeyB']) await tap(c);
  await tap('Enter', 20);
  if (!actx) say('Щёлкните по экрану, чтобы включить звук.');
}

$('reset').onclick = () => { if (running) { M._v_reset(0); screen.focus(); } };
$('full').onclick = () => { (screen.parentElement.requestFullscreen || screen.parentElement.webkitRequestFullscreen).call(screen.parentElement); };
$('vol').oninput = (e) => { volume = e.target.value / 100; if (node) node._gain.gain.value = volume; };
$('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'ДАЛЬШЕ' : 'ПАУЗА'; screen.focus(); };
$('shot').onclick = () => { const a = document.createElement('a'); a.download = 'gobliiins-' + Date.now() + '.png'; a.href = screen.toDataURL(); a.click(); };
$('build').textContent = BUILD;
for (const a of document.querySelectorAll('a.issue')) a.href += '?body=' + encodeURIComponent('Сборка: ' + BUILD + '\nБраузер: ' + navigator.userAgent + '\n\nЧто случилось:\n\nКак повторить:\n');

boot().catch((e) => { say('Ошибка: ' + e.message); console.error(e); });
window.gobDebug = () => ({ frames, queued, audioAlive, audio: actx && actx.state, running, paused });
