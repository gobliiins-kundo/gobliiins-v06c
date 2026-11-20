// Приём отчётов и телеметрии Gobliiins (страница ekundo.github.io/gobliiins-v06c) в D1.
//   POST /report  {kind, build, sid, ua, detector, text, frames, level, rec: base64 gzip, shot: base64 png}
//   POST /t       [{type, level, frame, data}, …] + ?sid=&build=
//   GET  /admin/reports?after=ID, /admin/report/ID, /admin/stats — заголовок Authorization: Bearer <ADMIN>
const ORIGINS = ['https://ekundo.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAXREC = 1500000, MAXSHOT = 300000;

function cors(req) {
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin' };
}
const json = (req, x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { 'Content-Type': 'application/json', ...cors(req) } });
const b64 = (s) => (s ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : null);
const str = (x, n) => (x == null ? null : String(x).slice(0, n));
const int = (x) => (Number.isFinite(+x) ? Math.trunc(+x) : null);

async function notify(env, msg) {
  if (!env.TG_TOKEN || !env.TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TG_CHAT, text: msg.slice(0, 3500), disable_web_page_preview: true }) }).catch(() => {});
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method === 'POST' && url.pathname === '/report') {
      const r = await req.json().catch(() => null);
      if (!r) return json(req, { error: 'bad json' }, 400);
      const rec = b64(r.rec), shot = b64(r.shot);
      if ((rec && rec.length > MAXREC) || (shot && shot.length > MAXSHOT)) return json(req, { error: 'too big' }, 413);
      const kind = r.kind === 'auto' ? 'auto' : 'user';
      const res = await env.DB.prepare('INSERT INTO reports (kind, build, sid, ua, detector, text, frames, level, rec, shot) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(kind, str(r.build, 40), str(r.sid, 40), str(r.ua, 300), str(r.detector, 200), str(r.text, 4000), int(r.frames), int(r.level), rec, shot).run();
      const id = res.meta.last_row_id;
      ctx.waitUntil(notify(env, `${kind === 'auto' ? '🤖 детектор: ' + (r.detector || '?') : '🙋 отчёт игрока'} #${id}\nсборка ${r.build}, уровень ${r.level ?? '?'}, кадр ${r.frames}\n${r.text || ''}`));
      return json(req, { id });
    }
    if (req.method === 'POST' && url.pathname === '/t') {
      const evs = await req.json().catch(() => null);
      if (!Array.isArray(evs)) return json(req, { error: 'bad json' }, 400);
      const sid = str(url.searchParams.get('sid'), 40), build = str(url.searchParams.get('build'), 40);
      const st = env.DB.prepare('INSERT INTO events (sid, build, type, level, frame, data) VALUES (?,?,?,?,?,?)');
      await env.DB.batch(evs.slice(0, 100).map((e) => st.bind(sid, build, str(e.type, 40) || '?', int(e.level), int(e.frame), e.data == null ? null : str(JSON.stringify(e.data), 2000))));
      return json(req, { ok: evs.length });
    }
    if (url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN || req.headers.get('Authorization') !== 'Bearer ' + env.ADMIN) return json(req, { error: 'auth' }, 401);
      if (url.pathname === '/admin/reports') {
        const { results } = await env.DB.prepare('SELECT id, at, kind, build, sid, detector, text, frames, level, length(rec) AS reclen FROM reports WHERE id > ? ORDER BY id LIMIT 500')
          .bind(int(url.searchParams.get('after')) || 0).all();
        return json(req, results);
      }
      const m = url.pathname.match(/^\/admin\/report\/(\d+)$/);
      if (m) {
        const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(+m[1]).first();
        if (!row) return json(req, { error: 'no' }, 404);
        const enc = (b) => { if (!b) return null; const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
        return json(req, { ...row, rec: enc(row.rec), shot: enc(row.shot) });
      }
      if (url.pathname === '/admin/stats') {
        const { results } = await env.DB.prepare("SELECT build, type, level, count(*) AS n, count(DISTINCT sid) AS sessions FROM events GROUP BY build, type, level ORDER BY build, type, level").all();
        return json(req, results);
      }
    }
    return json(req, { error: 'not found' }, 404);
  },
};
