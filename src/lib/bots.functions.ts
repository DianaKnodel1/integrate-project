// Bot-Automatisierung: Profile verwalten und Läufe in die Queue stellen.
// Der eigentliche Browser-Bot läuft als separater Dienst (bot-runner/).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/** Ein Schritt der Bot-Ablaufsteuerung. */
const StepSchema = z.object({
  action: z.enum(["goto", "fill", "click", "select", "wait", "screenshot", "handoff"]),
  selector: z.string().max(400).optional(),
  value: z.string().max(1000).optional(),
  label: z.string().max(160).optional(),
  optional: z.boolean().optional(),
  timeout: z.number().int().min(500).max(120000).optional(),
});

export type BotStep = z.infer<typeof StepSchema>;

export interface BotProfileRow {
  id: string;
  tenant_id: string | null;
  partner_company_id: string | null;
  name: string;
  provider_key: string;
  start_url: string;
  description: string | null;
  handoff_note: string | null;
  steps: BotStep[];
  is_active: boolean;
  created_at: string;
}

export interface BotRunRow {
  id: string;
  profile_id: string;
  tenant_id: string | null;
  user_id: string | null;
  assignment_id: string | null;
  vorgangsnummer: string | null;
  status: string;
  current_step: number;
  total_steps: number;
  credentials: Record<string, string>;
  input_data: Record<string, string>;
  log: { at: string; msg: string }[];
  handoff_reason: string | null;
  handoff_url: string | null;
  screenshot_path: string | null;
  last_error: string | null;
  claimed_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export const listBotProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotProfileRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_profiles").select("*").order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotProfileRow[] };
  });

const SaveProfileInput = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  partner_company_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  provider_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "Nur Kleinbuchstaben, Ziffern und _"),
  start_url: z.string().url().max(500),
  description: z.string().max(2000).optional().default(""),
  handoff_note: z.string().max(2000).optional().default(""),
  steps: z.array(StepSchema).max(120),
  is_active: z.boolean().optional().default(true),
});

export const saveBotProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveProfileInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const payload = {
      tenant_id: data.tenant_id || null,
      partner_company_id: data.partner_company_id || null,
      name: data.name,
      provider_key: data.provider_key,
      start_url: data.start_url,
      description: data.description || null,
      handoff_note: data.handoff_note || null,
      steps: data.steps,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { error } = await db.from("bot_profiles").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await db
      .from("bot_profiles")
      .insert({ ...payload, created_by: context.userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: String(row.id) };
  });

export const deleteBotProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_profiles").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBotRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotRunRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_runs").select("*")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotRunRow[] };
  });

/** Erzeugt ein starkes Passwort ohne verwechselbare Zeichen. */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const sym = "!@#$%&*?";
  const all = upper + lower + digit + sym;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]!;
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  for (let i = 0; i < 12; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

const EnqueueInput = z.object({
  profile_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().optional(),
  assignment_id: z.string().uuid().nullable().optional(),
  vorgangsnummer: z.string().max(60).optional().default(""),
  input_data: z.record(z.string(), z.string().max(500)).optional().default({}),
});

/**
 * Wählt den am längsten unbenutzten aktiven Proxy und erzeugt eine eigene
 * Sticky-Session-Kennung. So läuft jede Kontoeröffnung über eine eigene IP.
 */
async function allocateProxy(db: any): Promise<{ proxy_id: string | null; proxy_session: string }> {
  const session = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { data } = await db
    .from("bot_proxies")
    .select("id, use_count")
    .eq("is_active", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const proxy = Array.isArray(data) ? data[0] : null;
  if (!proxy) return { proxy_id: null, proxy_session: session };
  await db
    .from("bot_proxies")
    .update({ last_used_at: new Date().toISOString(), use_count: (proxy.use_count ?? 0) + 1 })
    .eq("id", proxy.id);
  return { proxy_id: String(proxy.id), proxy_session: session };
}

/** Legt einen Lauf an (gemeinsame Logik für Queue und Auftragsstart). */
async function createBotRun(
  db: any,
  createdBy: string,
  input: { profile_id: string; user_id?: string | null; assignment_id?: string | null; vorgangsnummer?: string; input_data?: Record<string, string> },
): Promise<{ id: string }> {
  const { data: profile, error: pErr } = await db
    .from("bot_profiles")
    .select("id, tenant_id, steps, is_active, name")
    .eq("id", input.profile_id).single();
  if (pErr) throw new Error(pErr.message);
  if (!profile.is_active) throw new Error("Bot-Profil ist deaktiviert");

  // Mitarbeiterdaten als Eingabewerte vorbelegen.
  let base: Record<string, string> = {};
  if (input.user_id) {
    const { data: prof } = await db
      .from("profiles")
      .select("full_name, street, house_number, postal_code, city, birth_date, phone")
      .eq("user_id", input.user_id).maybeSingle();
    if (prof) {
      const parts = String(prof.full_name ?? "").trim().split(/\s+/);
      base = {
        first_name: parts[0] ?? "",
        last_name: parts.slice(1).join(" "),
        street: [prof.street, prof.house_number].filter(Boolean).join(" "),
        zip: prof.postal_code ?? "",
        city: prof.city ?? "",
        birth_date: prof.birth_date ?? "",
        phone: prof.phone ?? "",
      };
    }
  }

  const { data: row, error } = await db
    .from("bot_runs")
    .insert({
      profile_id: profile.id,
      tenant_id: profile.tenant_id,
      user_id: input.user_id || null,
      assignment_id: input.assignment_id || null,
      vorgangsnummer: input.vorgangsnummer || null,
      status: "queued",
      total_steps: Array.isArray(profile.steps) ? profile.steps.length : 0,
      input_data: { ...base, ...(input.input_data ?? {}) },
      credentials: { password: generatePassword(), generated_at: new Date().toISOString() },
      ...(await allocateProxy(db)),
      created_by: createdBy,
    })
    .select("id").single();
  if (error) throw new Error(error.message);
  return { id: String(row.id) };
}

export const enqueueBotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EnqueueInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireAdmin(context);
    return createBotRun(context.supabase as any, context.userId, data);
  });

/** Admin übernimmt einen wartenden Lauf (VideoIdent o. Ä.). */
export const claimBotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db
      .from("bot_runs")
      .update({ claimed_by: context.userId, claimed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SetStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "waiting_admin", "done", "failed", "cancelled"]),
  note: z.string().max(1000).optional().default(""),
});

/** Admin setzt den Endstatus, nachdem er die manuellen Schritte erledigt hat. */
export const setBotRunStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetStatusInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const terminal = ["done", "failed", "cancelled"].includes(data.status);
    const { error } = await db
      .from("bot_runs")
      .update({
        status: data.status,
        finished_at: terminal ? new Date().toISOString() : null,
        last_error: data.status === "failed" ? (data.note || "Manuell als fehlgeschlagen markiert") : null,
        handoff_reason: data.note || null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
/* ----------------------------------------------------------- Proxy-Pool */

export interface BotProxyRow {
  id: string;
  label: string | null;
  provider: string;
  kind: string;
  host: string;
  port: number;
  username: string | null;
  country: string | null;
  is_active: boolean;
  last_used_at: string | null;
  use_count: number;
}

/** Liste ohne Passwörter — Zugangsdaten bleiben serverseitig. */
export const listBotProxies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotProxyRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_proxies")
      .select("id, label, provider, kind, host, port, username, country, is_active, last_used_at, use_count")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotProxyRow[] };
  });

const ImportProxiesInput = z.object({
  provider: z.string().max(60).optional().default("nsocks"),
  kind: z.enum(["http", "socks5"]).optional().default("http"),
  country: z.string().max(8).optional().default("DE"),
  /** Eine Zeile je Proxy: ip:port:user:pass (auch ip:port erlaubt). */
  raw: z.string().min(3).max(20000),
});

/** Importiert eine Proxy-Liste (z. B. aus dem nsocks-Dashboard). */
export const importBotProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ImportProxiesInput.parse(i))
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const line of data.raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[:;,\s]+/).filter(Boolean);
      const host = parts[0];
      const port = Number(parts[1]);
      if (!host || !Number.isFinite(port) || port <= 0) { skipped++; continue; }
      rows.push({
        provider: data.provider,
        kind: data.kind,
        country: data.country,
        host,
        port,
        username: parts[2] ?? null,
        password: parts[3] ?? null,
        label: `${data.provider} ${host}:${port}`,
      });
    }
    if (!rows.length) return { imported: 0, skipped };
    const { error } = await db.from("bot_proxies").upsert(rows, { onConflict: "host,port,username" });
    if (error) throw new Error(error.message);
    return { imported: rows.length, skipped };
  });

export const setBotProxyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_proxies").update({ is_active: data.is_active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBotProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_proxies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------------------------- Lauf zu einer Zuweisung */

/** Findet das passende Bot-Profil anhand der Vorlage bzw. deren Titel. */
async function resolveProfileForTemplate(db: any, templateId: string): Promise<string | null> {
  const { data: tpl } = await db
    .from("task_templates").select("title, bot_profile_id").eq("id", templateId).maybeSingle();
  if (!tpl) return null;
  if (tpl.bot_profile_id) return String(tpl.bot_profile_id);
  const title = String(tpl.title ?? "").toLowerCase();
  const map: [RegExp, string][] = [
    [/dkb/, "dkb"],
    [/deutsche\s*bank/, "deutsche_bank"],
    [/consors/, "consorsbank"],
    [/comdirect/, "comdirect"],
    [/santander/, "santander"],
  ];
  const hit = map.find(([re]) => re.test(title));
  if (!hit) return null;
  const { data: prof } = await db
    .from("bot_profiles").select("id").eq("provider_key", hit[1]).eq("is_active", true).limit(1);
  const row = Array.isArray(prof) ? prof[0] : null;
  return row ? String(row.id) : null;
}

/**
 * Startet für eine Zuweisung einen echten Bot-Lauf und setzt sie auf
 * "Entwurf" (= für den Mitarbeiter noch unsichtbar), bis freigegeben wird.
 */
export const startRunForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ assignment_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; run_id?: string; error?: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: a, error: aErr } = await db
      .from("task_assignments")
      .select("id, user_id, task_template_id, individual_email, individual_phone")
      .eq("id", data.assignment_id).single();
    if (aErr) throw new Error(aErr.message);

    const profileId = await resolveProfileForTemplate(db, String(a.task_template_id));
    if (!profileId) return { ok: false, error: "Kein passendes Bot-Profil für diese Vorlage hinterlegt." };

    // Läuft bereits ein Lauf? Dann keinen zweiten anlegen (Dublettenschutz).
    const { data: running } = await db
      .from("bot_runs").select("id")
      .eq("assignment_id", a.id)
      .in("status", ["queued", "running", "waiting_admin"]).limit(1);
    if (Array.isArray(running) && running.length) {
      return { ok: true, run_id: String(running[0].id) };
    }

    const extra: Record<string, string> = {};
    if (a.individual_email) extra["email"] = String(a.individual_email);
    if (a.individual_phone) extra["phone"] = String(a.individual_phone);

    const res = await createBotRun(db, context.userId, {
      profile_id: profileId,
      user_id: a.user_id,
      assignment_id: a.id,
      input_data: extra,
    });

    await db.from("task_assignments")
      .update({ status: "entwurf", updated_at: new Date().toISOString() })
      .eq("id", a.id);

    return { ok: true, run_id: String(res.id) };
  });

/** Aktueller Bot-Lauf einer Zuweisung (für die Statusanzeige). */
export const getRunForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ assignment_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ run: BotRunRow | null }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("bot_runs").select("*")
      .eq("assignment_id", data.assignment_id)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : null;
    return { run: (row ?? null) as BotRunRow | null };
  });

/**
 * Freigabe: erst wenn eine echte Vorgangsnummer vorliegt, wird die Zuweisung
 * für den Mitarbeiter sichtbar und er bekommt eine Chat-Info.
 */
export const releaseAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    assignment_id: z.string().uuid(),
    case_number: z.string().max(80).optional().default(""),
  }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: a, error } = await db
      .from("task_assignments")
      .select("id, user_id, individual_case_number, task_template_id")
      .eq("id", data.assignment_id).single();
    if (error) throw new Error(error.message);

    const caseNumber = data.case_number || a.individual_case_number || "";
    if (!caseNumber) return { ok: false, error: "Ohne Vorgangsnummer keine Freigabe möglich." };

    const { error: uErr } = await db.from("task_assignments").update({
      individual_case_number: caseNumber,
      assignment_group: "manuell",
      status: "zugewiesen",
      updated_at: new Date().toISOString(),
    }).eq("id", a.id);
    if (uErr) throw new Error(uErr.message);

    const { data: tpl } = await db
      .from("task_templates").select("title").eq("id", a.task_template_id).maybeSingle();
    await db.from("chat_messages").insert({
      sender_id: context.userId,
      receiver_id: a.user_id,
      message: `Neuer Auftrag: ${tpl?.title ?? "Auftrag"} – Vorgangsnummer ${caseNumber}. Details findest du im Portal.`,
    });

    return { ok: true };
  });
