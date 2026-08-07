import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

const ArchiveSchema = z.object({
  older_than_days: z.number().int().min(0).max(3650),
  dry_run: z.boolean().optional(),
});

/**
 * Archiviert Alt-Bewerbungen (kein Löschen).
 *
 * Bewerbungen, die älter als N Tage sind, verschwinden aus Liste und
 * Auswertung. Mitarbeiter-Konten (profiles) bleiben vollständig unangetastet —
 * archiviert wird ausschließlich der Bewerbungs-Datensatz.
 */
export const archiveOldApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArchiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const cutoff = new Date(Date.now() - data.older_than_days * 86_400_000).toISOString();

    const { count: candidates, error: cErr } = await sb
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("is_archived", false)
      .lt("created_at", cutoff);
    if (cErr) throw new Error(cErr.message);

    if (data.dry_run) return { archived: 0, candidates: candidates ?? 0 };

    const { error, count } = await sb
      .from("applications")
      .update({ is_archived: true, archived_at: new Date().toISOString() }, { count: "exact" })
      .eq("is_archived", false)
      .lt("created_at", cutoff);
    if (error) throw new Error(error.message);
    return { archived: count ?? 0, candidates: candidates ?? 0 };
  });

/** Holt archivierte Bewerbungen wieder in die aktive Liste zurück. */
export const unarchiveApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { error, count } = await sb
      .from("applications")
      .update({ is_archived: false, archived_at: null }, { count: "exact" })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { restored: count ?? 0 };
  });

/**
 * Setzt das Mail-Protokoll auf null.
 *
 * Danach ist jeder Eintrag im E-Mail-Center ein echtes, aktuelles Ereignis —
 * Alt-Fehler aus der Zeit vor den Fixes verfälschen die Diagnose nicht mehr.
 * Betrifft nur Protokolltabellen, keine Bewerbungen und keine Mitarbeiter.
 */
export const resetEmailSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal("MAIL RESET") }).parse(input))
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const result: Record<string, number | string> = {};

    const TABLES: Array<[string, string]> = [
      ["email_send_log", "id"],
      ["application_reminder_log", "id"],
      ["reminder_log", "id"],
      // appointment_reminder_log hat keine id-Spalte.
      ["appointment_reminder_log", "booking_id"],
    ];
    for (const [table, key] of TABLES) {
      try {
        const { count: before } = await sb.from(table).select(key, { count: "exact", head: true });
        // Alles löschen: Filter, der auf jede Zeile passt (Schlüssel ist nie null).
        const { error } = await sb.from(table).delete().not(key, "is", null);
        if (error) throw new Error(error.message);
        result[table] = before ?? 0;
      } catch (e: any) {
        result[table] = `Fehler: ${e?.message ?? e}`;
      }
    }
    return result;
  });
