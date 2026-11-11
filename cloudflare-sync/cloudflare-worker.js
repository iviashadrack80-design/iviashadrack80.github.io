const ALLOWED_ORIGIN = "https://iviashadrack80-design.github.io";
const USER_ID = "main";

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function ensureTables(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS journal_devices (token_hash TEXT PRIMARY KEY, device_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS journal_sync_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)")
  ]);
}
function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
}
async function authenticate(request, db) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const tokenHash = await digest(token);
  const row = await db.prepare("SELECT token_hash FROM journal_devices WHERE token_hash = ?").bind(tokenHash).first();
  if (!row) return false;
  await db.prepare("UPDATE journal_devices SET last_seen = ? WHERE token_hash = ?").bind(Date.now(), tokenHash).run();
  return true;
}
async function readSnapshot(db) {
  const [tradeRows, reviewRows, settingRow, metaRow] = await Promise.all([
    db.prepare("SELECT id, data FROM journal_trades WHERE user_id = ?").bind(USER_ID).all(),
    db.prepare("SELECT key, data FROM journal_reviews WHERE user_id = ?").bind(USER_ID).all(),
    db.prepare("SELECT data FROM journal_settings WHERE user_id = ?").bind(USER_ID).first(),
    db.prepare("SELECT revision FROM journal_sync_meta WHERE id = 1").first()
  ]);
  const settings = parseJson(settingRow?.data, {});
  return {
    revision: Number(metaRow?.revision || 0),
    trades: (tradeRows.results || []).map(row => {
      const value = parseJson(row.data, {});
      return { ...value, id: value.id ?? row.id };
    }),
    reviews: Object.fromEntries((reviewRows.results || []).map(row => [row.key, parseJson(row.data, null)])),
    account: settings.account || { start: 5000, risk: 1 },
    appearance: settings.appearance || null
  };
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "ShadrackTrades sync" }, 200, origin);
    }
    if (!env.DB) return json({ error: "D1 database binding DB is missing." }, 500, origin);
    try {
      await ensureTables(env.DB);
      if (url.pathname === "/pair" && request.method === "POST") {
        if (!env.PAIRING_CODE) return json({ error: "Worker pairing secret is not configured." }, 503, origin);
        const body = await request.json();
        if (typeof body.code !== "string" || body.code !== env.PAIRING_CODE) {
          return json({ error: "The pairing code is incorrect." }, 401, origin);
        }
        const token = randomToken();
        const tokenHash = await digest(token);
        const deviceName = String(body.deviceName || "Journal device").slice(0, 80);
        const now = Date.now();
        await env.DB.prepare("INSERT INTO journal_devices (token_hash, device_name, created_at, last_seen) VALUES (?, ?, ?, ?)")
          .bind(tokenHash, deviceName, now, now).run();
        return json({ token, message: "Device paired. Keep this device signed in." }, 200, origin);
      }
      if (url.pathname === "/sync" && (request.method === "GET" || request.method === "POST")) {
        if (!(await authenticate(request, env.DB))) return json({ error: "This device is not paired. Pair it again to continue." }, 401, origin);
        if (request.method === "GET") return json(await readSnapshot(env.DB), 200, origin);

        const body = await request.json();
        if (!Number.isInteger(body.expectedRevision) || !Array.isArray(body.trades) ||
            !body.reviews || typeof body.reviews !== "object" || Array.isArray(body.reviews) ||
            !body.account || typeof body.account !== "object") {
          return json({ error: "The sync data is incomplete or invalid." }, 400, origin);
        }
        const current = await readSnapshot(env.DB);
        if (body.expectedRevision !== current.revision) {
          return json({ error: "The journal changed on another device. Download the latest copy before saving.", conflict: true, revision: current.revision }, 409, origin);
        }
        const nextRevision = current.revision + 1;
        const statements = [
          env.DB.prepare("DELETE FROM journal_trades WHERE user_id = ?").bind(USER_ID),
          env.DB.prepare("DELETE FROM journal_reviews WHERE user_id = ?").bind(USER_ID)
        ];
        for (const trade of body.trades) {
          if (!trade || trade.id == null) continue;
          statements.push(env.DB.prepare("INSERT INTO journal_trades (id, user_id, data) VALUES (?, ?, ?)")
            .bind(String(trade.id), USER_ID, JSON.stringify(trade)));
        }
        for (const [key, value] of Object.entries(body.reviews)) {
          statements.push(env.DB.prepare("INSERT INTO journal_reviews (user_id, key, data) VALUES (?, ?, ?)")
            .bind(USER_ID, String(key), JSON.stringify(value)));
        }
        statements.push(env.DB.prepare("INSERT INTO journal_settings (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
          .bind(USER_ID, JSON.stringify({ account: body.account, appearance: body.appearance || null })));
        statements.push(env.DB.prepare("INSERT INTO journal_sync_meta (id, revision) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision")
          .bind(nextRevision));
        await env.DB.batch(statements);
        return json({ ok: true, revision: nextRevision }, 200, origin);
      }
      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      return json({ error: error?.message || "Unexpected sync error." }, 500, origin);
    }
  }
};