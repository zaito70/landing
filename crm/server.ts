// CRM de leads para la landing de la clase gratuita.
// Ejecutar:  bun run server.ts   (variables en .env, ver .env.example)
import { Database } from "bun:sqlite";

const PORT = Number(process.env.PORT ?? 3010);
const CRM_TOKEN = process.env.CRM_TOKEN ?? "";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map(s => s.trim());
const DB_PATH = process.env.DB_PATH ?? "crm.sqlite";

if (!CRM_TOKEN) console.warn("⚠ CRM_TOKEN vacío: el panel queda sin contraseña. Defínelo en .env");

export const STAGES = ["nuevo", "contactado", "asistio", "interesado", "cliente", "perdido"] as const;
type Stage = (typeof STAGES)[number];

// ---------- base de datos ----------
const db = new Database(DB_PATH, { create: true });
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'nuevo',
  source TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_contact_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- registro | nota | etapa | whatsapp | email | llamada | automatizacion
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS act_lead ON activities(lead_id);
`);

const q = {
  byEmail: db.query("SELECT * FROM leads WHERE email = ?"),
  byId: db.query("SELECT * FROM leads WHERE id = ?"),
  insert: db.query(`INSERT INTO leads (name,email,whatsapp,source,utm_source,utm_medium,utm_campaign,utm_content)
                    VALUES ($name,$email,$whatsapp,$source,$utm_source,$utm_medium,$utm_campaign,$utm_content) RETURNING *`),
  touch: db.query("UPDATE leads SET name=$name, whatsapp=$whatsapp, updated_at=datetime('now') WHERE id=$id"),
  addAct: db.query("INSERT INTO activities (lead_id, kind, body) VALUES (?, ?, ?) RETURNING *"),
  acts: db.query("SELECT * FROM activities WHERE lead_id = ? ORDER BY id DESC"),
  stats: db.query("SELECT stage, COUNT(*) n FROM leads GROUP BY stage"),
  daily: db.query(`SELECT date(created_at) d, COUNT(*) n FROM leads
                   WHERE created_at >= datetime('now','-13 days') GROUP BY d ORDER BY d`),
  sources: db.query(`SELECT COALESCE(NULLIF(utm_source,''),'directo') s, COUNT(*) n FROM leads GROUP BY s ORDER BY n DESC LIMIT 8`),
};

// ---------- utilidades ----------
const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const phoneNorm = (p: string) => p.replace(/[^\d+]/g, "");
const phoneOk = (p: string) => /^\+\d{8,15}$/.test(p);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : "";
  return allow
    ? { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" }
    : {};
}
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extra } });

function authed(req: Request) {
  if (!CRM_TOKEN) return true;
  return req.headers.get("authorization") === `Bearer ${CRM_TOKEN}`;
}

// Límite simple: 20 intentos por IP cada 10 minutos (holgado: muchas personas comparten IP móvil).
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now(), win = 10 * 60_000;
  const list = (hits.get(ip) ?? []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > 20;
}

// Aviso a n8n. No bloquea la respuesta y nunca tumba el CRM si n8n está caído.
function notify(event: string, lead: any, extra: Record<string, unknown> = {}) {
  if (!N8N_WEBHOOK_URL) return;
  fetch(N8N_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, lead, ...extra, ts: new Date().toISOString() }),
  }).catch(err => console.warn(`n8n no respondió (${event}):`, err.message));
}

// ---------- rutas ----------
async function createLead(req: Request, ip: string) {
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Envía los datos en formato JSON." }, 400); }
  if (clean(b.website)) return json({ ok: true }); // campo trampa para bots: se ignora en silencio
  if (rateLimited(ip)) return json({ error: "Demasiados registros desde esta conexión. Intenta en unos minutos." }, 429);

  const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), whatsapp = phoneNorm(clean(b.whatsapp, 30));
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = "Escribe tu nombre.";
  if (!emailOk(email)) errors.email = "El email no es válido.";
  if (!phoneOk(whatsapp)) errors.whatsapp = "Incluye el código de país, por ejemplo +57 300 123 4567.";
  if (Object.keys(errors).length) return json({ error: "Revisa los campos marcados.", errors }, 422);

  const existing = q.byEmail.get(email) as any;
  if (existing) {
    q.touch.run({ $id: existing.id, $name: name, $whatsapp: whatsapp });
    q.addAct.run(existing.id, "registro", `Se registró de nuevo desde ${clean(b.source) || "la landing"}`);
    const lead = q.byId.get(existing.id);
    notify("lead.repeated", lead);
    return json({ ok: true, id: existing.id, repeated: true });
  }
  const lead = q.insert.get({
    $name: name, $email: email, $whatsapp: whatsapp, $source: clean(b.source) || "landing",
    $utm_source: clean(b.utm_source), $utm_medium: clean(b.utm_medium),
    $utm_campaign: clean(b.utm_campaign), $utm_content: clean(b.utm_content),
  }) as any;
  q.addAct.run(lead.id, "registro", `Registro desde ${lead.source}${lead.utm_source ? ` (utm: ${lead.utm_source}/${lead.utm_campaign})` : ""}`);
  notify("lead.created", lead);
  return json({ ok: true, id: lead.id }, 201);
}

function listLeads(url: URL) {
  const where: string[] = [], params: Record<string, string> = {};
  const stage = url.searchParams.get("stage"), search = url.searchParams.get("q");
  if (stage && STAGES.includes(stage as Stage)) { where.push("stage = $stage"); params.$stage = stage; }
  if (search) { where.push("(name LIKE $q OR email LIKE $q OR whatsapp LIKE $q OR tags LIKE $q)"); params.$q = `%${search}%`; }
  const sql = `SELECT * FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 1000`;
  return db.query(sql).all(params);
}

async function updateLead(id: number, req: Request) {
  const lead = q.byId.get(id) as any;
  if (!lead) return json({ error: "Ese lead no existe." }, 404);
  const b: any = await req.json().catch(() => ({}));
  const sets: string[] = [], params: Record<string, string | number> = { $id: id };
  if (b.stage !== undefined) {
    if (!STAGES.includes(b.stage)) return json({ error: `Etapa no válida. Usa: ${STAGES.join(", ")}` }, 422);
    if (b.stage !== lead.stage) { sets.push("stage = $stage"); params.$stage = b.stage; }
  }
  for (const f of ["name", "whatsapp", "tags"] as const) {
    if (b[f] !== undefined) { sets.push(`${f} = $${f}`); params[`$${f}`] = f === "whatsapp" ? phoneNorm(clean(b[f], 30)) : clean(b[f], 300); }
  }
  if (!sets.length) return json(lead);
  db.query(`UPDATE leads SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = $id`).run(params);
  const updated = q.byId.get(id) as any;
  if (params.$stage) {
    q.addAct.run(id, "etapa", `Etapa: ${lead.stage} → ${updated.stage}`);
    notify("lead.stage_changed", updated, { from: lead.stage, to: updated.stage });
  }
  return json(updated);
}

async function addActivity(id: number, req: Request) {
  if (!q.byId.get(id)) return json({ error: "Ese lead no existe." }, 404);
  const b: any = await req.json().catch(() => ({}));
  const kind = clean(b.kind, 30) || "nota", body = clean(b.body, 4000);
  if (!body) return json({ error: "La actividad necesita un texto." }, 422);
  const act = q.addAct.get(id, kind, body);
  if (["whatsapp", "email", "llamada"].includes(kind))
    db.query("UPDATE leads SET last_contact_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  return json(act, 201);
}

function exportCsv() {
  const rows = db.query("SELECT id,name,email,whatsapp,stage,tags,source,utm_source,utm_medium,utm_campaign,created_at,last_contact_at FROM leads ORDER BY id").all() as any[];
  const cols = ["id", "name", "email", "whatsapp", "stage", "tags", "source", "utm_source", "utm_medium", "utm_campaign", "created_at", "last_contact_at"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="leads.csv"' } });
}

const panel = Bun.file(new URL("./public/index.html", import.meta.url));

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url), path = url.pathname, h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const ip = srv.requestIP(req)?.address ?? "?";
    const withCors = (r: Response) => { for (const [k, v] of Object.entries(h)) r.headers.set(k, v); return r; };

    try {
      // Pública: la usa la landing.
      if (path === "/api/leads" && req.method === "POST") return withCors(await createLead(req, ip));
      if (path === "/health") return json({ ok: true });
      if (path === "/" || path === "/index.html") return new Response(panel, { headers: { "Content-Type": "text/html; charset=utf-8" } });

      // Privadas: requieren CRM_TOKEN.
      if (path.startsWith("/api/")) {
        if (!authed(req)) return withCors(json({ error: "Contraseña del CRM incorrecta." }, 401));
        if (path === "/api/meta") return json({ stages: STAGES, n8n: Boolean(N8N_WEBHOOK_URL) });
        if (path === "/api/leads" && req.method === "GET") return json(listLeads(url));
        if (path === "/api/stats") return json({ stages: q.stats.all(), daily: q.daily.all(), sources: q.sources.all() });
        if (path === "/api/export.csv") return exportCsv();
        const m = path.match(/^\/api\/leads\/(\d+)(\/activities)?$/);
        if (m) {
          const id = Number(m[1]);
          if (m[2] && req.method === "GET") return json(q.acts.all(id));
          if (m[2] && req.method === "POST") return addActivity(id, req);
          if (req.method === "GET") { const l = q.byId.get(id); return l ? json(l) : json({ error: "Ese lead no existe." }, 404); }
          if (req.method === "PATCH") return updateLead(id, req);
          if (req.method === "DELETE") { db.query("DELETE FROM leads WHERE id = ?").run(id); return json({ ok: true }); }
        }
      }
      return json({ error: "Ruta no encontrada." }, 404);
    } catch (err: any) {
      console.error(err);
      return withCors(json({ error: "Error interno del CRM. Revisa la consola del servidor." }, 500));
    }
  },
});

console.log(`CRM listo en http://localhost:${server.port}  ·  n8n: ${N8N_WEBHOOK_URL ? "conectado" : "sin configurar"}`);
