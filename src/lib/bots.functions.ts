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

export const enqueueBotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EnqueueInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;

    const { data: profile, error: pErr } = await db
      .from("bot_profiles")
      .select("id, tenant_id, steps, is_active, name")
      .eq("id", data.profile_id).single();
    if (pErr) throw new Error(pErr.message);
    if (!profile.is_active) throw new Error("Bot-Profil ist deaktiviert");

    // Mitarbeiterdaten als Eingabewerte vorbelegen.
    let base: Record<string, string> = {};
    if (data.user_id) {
      const { data: prof } = await db
        .from("profiles")
        .select("full_name, street, house_number, postal_code, city, birth_date, phone")
        .eq("user_id", data.user_id).maybeSingle();
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
        user_id: data.user_id || null,
        assignment_id: data.assignment_id || null,
        vorgangsnummer: data.vorgangsnummer || null,
        status: "queued",
        total_steps: Array.isArray(profile.steps) ? profile.steps.length : 0,
        input_data: { ...base, ...data.input_data },
        credentials: { password: generatePassword(), generated_at: new Date().toISOString() },
        created_by: context.userId,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: String(row.id) };
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