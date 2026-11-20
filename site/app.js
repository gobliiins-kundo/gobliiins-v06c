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

// ---- запись сессии: ввод с кадром от включения + сверочные суммы картинки. Ядро детерминировано: проигрыватель
// (tools/replay.cjs) повторяет сессию кадр в кадр с того же образа ----
const rec = { v: 1, build: BUILD, ua: navigator.userAgent, started: new Date().toISOString(), events: [], hashes: [] };
const ev = (...a) => rec.events.push([frames, ...a]);
function vkey(c, d) { ev('k', c, d); M._v_key(c, d); }
let lastMouse = '';
function vmouse(x, y, b, w, inside) {
  const k = inside ? x + ',' + y + ',' + b : 'o' + b;
  if (k !== lastMouse || w) { lastMouse = k; ev('m', x, y, b, w, inside); }
  M._v_mouse(x, y, b, w, inside);
}
function vreset(blk) { ev('r', blk); M._v_reset(blk); }
// ---- отчёты и телеметрия: сервер gob-reports (Cloudflare Worker + D1), анонимно, отключается галочкой ----
const API = 'https://gob-reports.gobliiins.workers.dev';
const SID = Math.random().toString(36).slice(2, 12);
const tq = [];
let sendOK = true;
try { sendOK = localStorage.getItem('gob-telemetry') !== 'off'; } catch (e) { /* без хранилища — по умолчанию */ }
function tel(type, data) { if (sendOK) tq.push({ type, frame: frames, data }); }
function flush(beacon) {
  if (!sendOK || !tq.length) return;
  const body = JSON.stringify(tq.splice(0, 100)), url = API + '/t?sid=' + SID + '&build=' + BUILD;
  if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
  else fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}
setInterval(() => flush(false), 30000);
addEventListener('pagehide', () => { tel('end', { frames }); flush(true); });
async function gzip64(str) {
  const buf = new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(s);
}
async function sendReport(kind, text, detector) {
  rec.frames = frames; rec.saved = new Date().toISOString();
  const shot = screen.toDataURL('image/png').split(',')[1];
  const body = { kind, text, detector, build: BUILD, sid: SID, ua: navigator.userAgent, frames, rec: await gzip64(JSON.stringify(rec)), shot };
  const r = await fetch(API + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('сервер ответил ' + r.status);
  return (await r.json()).id;
}

// детекторы: на конце каждого кадра — дёшево. Срабатывание — автоотчёт с записью (раз на вид за сессию)
const fired = new Set();
let diFrames = 0, pcLo = 0xffff, pcHi = 0, vidPc = 0;
function detect() {
  const pc = M._v_pc(), iff = M._v_iff();
  // зависание: прерывания запрещены 5 с подряд, а PC крутится в узком месте
  if (!iff) { diFrames++; pcLo = Math.min(pcLo, pc); pcHi = Math.max(pcHi, pc); } else { diFrames = 0; pcLo = 0xffff; pcHi = 0; }
  if (diFrames === 250 && pcHi - pcLo < 64) hit('hang-di', { pc: pcLo.toString(16) + '-' + pcHi.toString(16) });
  // исполнение в видеопамяти первого плана (8000h-9FFFh): там кода не бывает
  if (pc >= 0x8000 && pc < 0xa000) { if (++vidPc === 3) hit('pc-in-video', { pc: pc.toString(16), sp: M._v_sp().toString(16) }); } else vidPc = 0;
}
function hit(name, data) {
  tel('detector', { name, ...data });
  if (fired.has(name) || !sendOK) return;
  fired.add(name);
  console.warn('детектор', name, data);
  sendReport('auto', JSON.stringify(data), name).catch(() => {});
}

function fnv(u8) { let h = 0x811c9dc5; const u = new Uint32Array(u8.buffer, u8.byteOffset, u8.length >> 2); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h; }

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
  if (frames % 500 === 0) rec.hashes.push([frames, fnv(pix)]);
  detect();
  const a = M._v_audio(PER_FRAME) >> 2;
  if (node && actx.state === 'running') {
    node.port.postMessage(M.HEAPF32.slice(a, a + PER_FRAME * 2));
    queued += PER_FRAME;
  }
}

let last = 0, acc = 0, perfF = 0, perfT = 0, starve = 0;
setInterval(() => {
  if (!running || paused) return;
  const now = performance.now();
  if (perfT) tel('perf', { fps: Math.round((frames - perfF) * 10000 / (now - perfT)) / 10, starve, audio: actx ? actx.state : 'off', hidden: document.hidden });
  perfF = frames; perfT = now; starve = 0;
}, 60000);
function loop(t) {
  requestAnimationFrame(loop);
  if (!running || paused) { last = t; return; }
  let n = 0;
  // темп — по часам страницы (кадр 20 мс); звук подтягивает: мало в кольце — кадр лишний, много — пропуск
  acc += Math.min(200, t - (last || t));
  const audioOn = node && actx.state === 'running' && audioAlive > performance.now() - 500;
  if (audioOn && queued > PER_FRAME * 6) acc -= 2;
  if (audioOn && queued < PER_FRAME * 2) acc += 2;
  if (audioOn && queued < PER_FRAME / 2) starve++;
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
  // текст в поле отчёта и прочих полях страницы — им, не эмулятору
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
  const c = KEYMAP[e.code];
  if (c === undefined) return;
  if (e.metaKey && e.code !== 'MetaLeft' && e.code !== 'MetaRight') return;   // Cmd+... — браузеру
  e.preventDefault();
  startAudio();
  if (down) { if (held.has(e.code)) return; held.add(e.code); } else held.delete(e.code);
  vkey(c, down ? 1 : 0);
}
window.addEventListener('keydown', (e) => key(e, true));
window.addEventListener('keyup', (e) => key(e, false));
window.addEventListener('blur', () => { if (running) for (const c of held) vkey(KEYMAP[c], 0); held.clear(); });

// ---- мышь: координаты холста -> точки Вектора (x 0..511, y 0..255 снизу) ----
let mb = 0;
function mouse(e, wheel = 0) {
  if (!running) return;
  const r = screen.getBoundingClientRect();
  const tx = (e.clientX - r.left) * W / r.width, ty = (e.clientY - r.top) * H / r.height;
  const x = Math.floor(tx - BORDER), row = Math.floor(ty + (312 - H) - 40);
  const inside = x >= 0 && x < 512 && row >= 0 && row < 256;
  vmouse(x, 255 - row, mb, wheel, inside ? 1 : 0);
}
screen.addEventListener('mousemove', (e) => mouse(e));
screen.addEventListener('mousedown', (e) => { startAudio(); screen.focus(); mb |= [1, 4, 2][e.button] || 0; mouse(e); e.preventDefault(); });
window.addEventListener('mouseup', (e) => { mb &= ~([1, 4, 2][e.button] || 0); mouse(e); });
screen.addEventListener('contextmenu', (e) => e.preventDefault());
screen.addEventListener('wheel', (e) => { mouse(e, Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });

// ---- набор с клавиатуры Вектора (запуск игры из CO) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFrames(n) { const f0 = frames; while (frames - f0 < n) await sleep(10); }
async function tap(code, hold = 8) { vkey(KEYMAP[code], 1); await waitFrames(hold); vkey(KEYMAP[code], 0); await waitFrames(8); }

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
  vreset(0);
  running = true;
  requestAnimationFrame(loop);
  say('Загружается система T-72…');
  await waitFrames(200);
  for (const c of ['Tab', 'KeyG', 'KeyO', 'KeyB']) await tap(c);
  await tap('Enter', 20);
  if (!actx) say('Щёлкните по экрану, чтобы включить звук.');
}

$('reset').onclick = () => { if (running) { vreset(0); screen.focus(); } };
// во весь экран — корпус с клавишами; Esc в Chrome держим за собой (Keyboard Lock), выход — долгое нажатие Esc или кнопка ЭКРАН
const box = document.querySelector('.case');
$('full').onclick = async () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  await (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
  try { await navigator.keyboard.lock(['Escape']); } catch (e) { /* Safari, Firefox: Esc выходит из полного экрана — есть кнопка АР2 */ }
  screen.focus();
};
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) try { navigator.keyboard.unlock(); } catch (e) {} });
$('ar2').onclick = () => { if (running) { startAudio(); tap('Escape'); screen.focus(); } };
$('vol').oninput = (e) => { volume = e.target.value / 100; if (node) node._gain.gain.value = volume; };
$('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'ДАЛЬШЕ' : 'ПАУЗА'; screen.focus(); };
$('shot').onclick = () => { const a = document.createElement('a'); a.download = 'gobliiins-' + Date.now() + '.png'; a.href = screen.toDataURL(); a.click(); };
$('build').textContent = BUILD;
$('telemetry').checked = sendOK;
$('telemetry').onchange = (e) => { sendOK = e.target.checked; try { localStorage.setItem('gob-telemetry', sendOK ? 'on' : 'off'); } catch (x) {} };
$('bug').onclick = () => { paused = true; $('pause').textContent = 'ДАЛЬШЕ'; $('bugform').hidden = false; $('bugtext').focus(); };
$('bugcancel').onclick = () => { $('bugform').hidden = true; screen.focus(); };
$('bugsend').onclick = async () => {
  const t = $('bugtext').value.trim(), st = $('bugstatus');
  st.textContent = 'Отправляю…';
  try { const id = await sendReport('user', t, null); st.textContent = 'Отправлено, номер ' + id + '. Спасибо!'; $('bugtext').value = ''; }
  catch (e) { st.textContent = 'Не отправилось (' + e.message + '). Скачайте запись и приложите к issue.'; }
};
// запись сессии файлом (gzip): прикладывать к issue
$('recdl').onclick = async (e) => {
  e.preventDefault();
  rec.frames = frames; rec.saved = new Date().toISOString();
  const blob = new Blob([JSON.stringify(rec)]).stream().pipeThrough(new CompressionStream('gzip'));
  const a = document.createElement('a'); a.download = 'gobliiins-' + BUILD + '-' + frames + '.json.gz';
  a.href = URL.createObjectURL(await new Response(blob).blob()); a.click();
};
for (const a of document.querySelectorAll('a.issue')) a.href += '?body=' + encodeURIComponent('Сборка: ' + BUILD + '\nБраузер: ' + navigator.userAgent + '\n\nЧто случилось:\n\nКак повторить:\n');

addEventListener('error', (e) => hit('js-error', { msg: String(e.message).slice(0, 300) }));
boot().then(() => tel('start', { w: innerWidth, h: innerHeight })).catch((e) => { say('Ошибка: ' + e.message); console.error(e); tel('boot-fail', { msg: e.message }); flush(false); });
window.gobRec = rec;
window.gobDebug = () => ({ events: rec.events.length, frames, queued, audioAlive, audio: actx && actx.state, running, paused });
window.gobStep = (n) => { for (let i = 0; i < n; i++) frame(); ctx.putImageData(img, 0, 0); return frames; };   // отладка: кадры без часов страницы
