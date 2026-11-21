// Проигрыватель записи сессии (кнопка «запись игры» на странице) на том же ядре, что в браузере.
//   node tools/replay.cjs запись.json.gz [--png кадр,кадр…] [--mem кадр,кадр…] [--out каталог] [--until кадр]
// --watch адр,адр…: печатать кадр и байты, когда они меняются (адреса в hex)
// --patch адр:старые:новые (hex): подменить байты кода, как только в памяти по адресу стоят старые (проверка правки на записи)
// --mem: 64 КБ памяти, как её видит процессор, в f<кадр>.mem
// Сверяет суммы картинки из записи (каждые 500 кадров): совпали — сессия повторена кадр в кадр.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const raw = fs.readFileSync(args[0]);
const rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
const pngs = new Set((opt('--png', '') || '').split(',').filter(Boolean).map(Number));
const mems = new Set((opt('--mem', '') || '').split(',').filter(Boolean).map(Number));
const watch = (opt('--watch', '') || '').split(',').filter(Boolean).map((x) => parseInt(x, 16)); let wprev = '';
const patches = (opt('--patch', '') || '').split(',').filter(Boolean).map((x) => { const [a, o, n] = x.split(':'); return { a: parseInt(a, 16), o: Buffer.from(o, 'hex'), n: Buffer.from(n, 'hex'), k: 0 }; });
const outDir = opt('--out', '.');
const until = +opt('--until', rec.frames || (rec.events.length ? rec.events[rec.events.length - 1][0] + 500 : 3000));
const fnv = (u8) => { let h = 0x811c9dc5; const u = new Uint32Array(u8.buffer, u8.byteOffset, u8.length >> 2); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h; };
function ppm(file, px, W, H) {   // P6 без зависимостей; в PNG: sips -s format png
  const b = Buffer.alloc(W * H * 3); for (let i = 0, j = 0; i < W * H * 4; i += 4) { b[j++] = px[i]; b[j++] = px[i + 1]; b[j++] = px[i + 2]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), b]));
}
require(path.join(ROOT, 'build/v06x-node.js'))().then((M) => {
  M._v_init();
  M._v_set_pcm(rec.pcm === false ? 0 : 1);
  const W = M._v_width(), H = M._v_height();
  M.FS.writeFile('/gob.hdd', fs.readFileSync(opt('--hdd', path.join(ROOT, 'site/data/gob.hdd'))));
  if (!M.ccall('v_attach_hdd', 'number', ['string'], ['/gob.hdd'])) throw new Error('hdd');
  const rom = fs.readFileSync(opt('--rom', path.join(ROOT, 'site/data/os-t72h.rom')));
  const p = M._malloc(rom.length); M.HEAPU8.set(rom, p); M._v_load_rom(p, rom.length, 0x100); M._free(p);
  const hashes = new Map(rec.hashes.map(([f, h]) => [f, h]));
  let ei = 0, ok = 0, bad = 0, di = 0, lo = 0xffff, hi = 0, vp = 0, maxdi = 0;
  for (let f = 0; f <= until; f++) {
    while (ei < rec.events.length && rec.events[ei][0] === f) {
      const e = rec.events[ei++];
      if (e[1] === 'k') M._v_key(e[2], e[3]);
      else if (e[1] === 'm') M._v_mouse(e[2], e[3], e[4], e[5], e[6]);
      else if (e[1] === 'r') M._v_reset(e[2]);
    }
    if (f === until) break;
    const ptr = M._v_frame(); M._v_audio(960);
    const px = M.HEAPU8.subarray(ptr, ptr + W * H * 4), n = f + 1;
    // те же детекторы, что на странице (site/app.js detect)
    const pc = M._v_pc(), iff = M._v_iff();
    if (!iff) { di++; lo = Math.min(lo, pc); hi = Math.max(hi, pc); maxdi = Math.max(maxdi, di); } else { di = 0; lo = 0xffff; hi = 0; }
    if (di === 250 && hi - lo < 64) console.log('детектор hang-di: кадр', n, 'pc', lo.toString(16), hi.toString(16));
    if (pc >= 0x8000 && pc < 0xa000) { if (++vp === 3) console.log('детектор pc-in-video: кадр', n, 'pc', pc.toString(16)); } else vp = 0;
    if (hashes.has(n)) { if (fnv(px) === hashes.get(n)) ok++; else { bad++; if (bad <= 5) console.log('кадр', n, 'не совпал'); } }
    for (const P of patches) { let same = true; for (let i = 0; i < P.o.length && same; i++) same = M._v_peek(P.a + i) === P.o[i]; if (same) { for (let i = 0; i < P.n.length; i++) M._v_poke(P.a + i, P.n[i]); if (!P.k++) console.log('правка', P.a.toString(16), 'с кадра', n); } }
    if (watch.length) { const w = watch.map((a) => M._v_peek(a).toString(16).padStart(2, '0')).join(' '); if (w !== wprev) { console.log('кадр', n, w); wprev = w; } }
    if (mems.has(n)) { const m = Buffer.alloc(65536); for (let a = 0; a < 65536; a++) m[a] = M._v_peek(a); fs.writeFileSync(path.join(outDir, 'f' + n + '.mem'), m); }
    if (pngs.has(n)) ppm(path.join(outDir, 'f' + n + '.ppm'), px, W, H);
  }
  console.log('сборка записи', rec.build, '| кадров', until, '| событий', rec.events.length, '| сверка картинки: совпало', ok, 'не совпало', bad, '| дольше всего под DI', maxdi, 'кадров');
  process.exit(bad ? 2 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
