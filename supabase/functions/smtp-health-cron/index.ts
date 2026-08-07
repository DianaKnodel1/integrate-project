// Deno Edge Function: smtp-health-cron
// Prüft alle 30 Min für jeden aktiven Tenant die SMTP-Verbindung (nur
// Connect + AUTH, es wird KEINE Mail versendet) und pflegt tenant_smtp_health.
//
// Regeln:
//   - Erfolg  -> consecutive_fails = 0, last_verify_ok = true
//               + hebt eine automatische Pause (emails_paused_by LIKE 'auto:%')
//                 wieder auf. Manuelle Pausen bleiben bestehen.
//   - Fehler  -> consecutive_fails += 1; ab 3 in Folge wird der Tenant
//               automatisch pausiert (emails_paused_by = 'auto:smtp_fail').
//   - Keine SMTP-Daten -> Status "nicht konfiguriert", KEINE Pause, kein Fail.
//
// Auth: ?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const FAIL_THRESHOLD = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function classify(message: string) {
  const n = message.toLowerCase();
  if (n.includes("535") || n.includes("auth") || n.includes("login")) return "Login fehlgeschlagen (Benutzer/Passwort)";
  if (n.includes("timeout") || n.includes("etimedout")) return "Server antwortet nicht (Timeout)";
  if (n.includes("econnrefused")) return "Verbindung abgelehnt (Host/Port)";
  if (n.includes("enotfound") || n.includes("getaddrinfo")) return "Host nicht auflösbar (DNS)";
  if (n.includes("certificate") || n.includes("tls") || n.includes("ssl")) return "TLS/SSL-Fehler";
  return message;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL") ?? "";

  const providedKey = (url.searchParams.get("key") ?? req.headers.get("x-cron-secret") ?? "").trim();
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  const authorized =
    (cronSecret && providedKey === cronSecret) ||
    (serviceKey && (bearer === serviceKey || apikey === serviceKey));

  if (!authorized) return json({ error: "Unauthorized" }, 401);
  if (!supabaseUrl || !serviceKey) return json({ error: "Server-Konfiguration fehlt" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id,name,sender_email,smtp_host,smtp_port,smtp_username,smtp_password,emails_paused,emails_paused_by")
    .eq("is_active", true);
  if (error) return json({ error: error.message }, 500);

  const now = new Date().toISOString();
  const results: any[] = [];

  for (const t of tenants ?? []) {
    const configured = !!(t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);

    if (!configured) {
      await admin.from("tenant_smtp_health").upsert({
        tenant_id: t.id,
        consecutive_fails: 0,
        last_verify_at: now,
        last_verify_ok: null,
        last_fail_error: "SMTP-Zugangsdaten nicht hinterlegt",
        updated_at: now,
      });
      results.push({ tenant: t.name, state: "not_configured" });
      continue;
    }

    let ok = false;
    let errMsg = "";
    try {
      const transporter = createSmtpTransport(t as any);
      await Promise.race([
        transporter.verify(),
        new Promise((_r, reject) => setTimeout(() => reject(new Error("verify timeout 25s")), 25000)),
      ]);
      ok = true;
    } catch (e: any) {
      errMsg = classify(String(e?.message ?? e));
    }

    if (ok) {
      await admin.from("tenant_smtp_health").upsert({
        tenant_id: t.id,
        consecutive_fails: 0,
        last_verify_at: now,
        last_verify_ok: true,
        last_fail_error: null,
        updated_at: now,
      });

      const autoPaused = t.emails_paused && typeof t.emails_paused_by === "string" && t.emails_paused_by.startsWith("auto:");
      if (autoPaused) {
        await admin.from("tenants").update({
          emails_paused: false,
          emails_paused_at: null,
          emails_paused_reason: null,
          emails_paused_by: null,
          updated_at: now,
        }).eq("id", t.id);
        await admin.from("activity_log").insert({
          action: "emails_reaktiviert",
          entity_type: "tenant",
          entity_id: t.id,
          comment: `Automatisch freigegeben: SMTP-Check wieder erfolgreich (vorher: ${t.emails_paused_by}).`,
        });
        results.push({ tenant: t.name, state: "ok", auto_resumed: true });
        continue;
      }
      results.push({ tenant: t.name, state: "ok" });
      continue;
    }

    const { data: h } = await admin
      .from("tenant_smtp_health")
      .select("consecutive_fails")
      .eq("tenant_id", t.id)
      .maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;

    await admin.from("tenant_smtp_health").upsert({
      tenant_id: t.id,
      consecutive_fails: fails,
      last_verify_at: now,
      last_verify_ok: false,
      last_fail_at: now,
      last_fail_error: errMsg,
      updated_at: now,
    });

    let paused = false;
    if (fails >= FAIL_THRESHOLD && !t.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: now,
        emails_paused_reason: `SMTP-Fehler ${fails}x in Folge: ${errMsg}`,
        emails_paused_by: "auto:smtp_fail",
        updated_at: now,
      }).eq("id", t.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert",
        entity_type: "tenant",
        entity_id: t.id,
        comment: `Mail-Versand gestoppt: SMTP-Login ${fails}x in Folge fehlgeschlagen (${errMsg}). Wird automatisch freigegeben, sobald SMTP wieder funktioniert.`,
      });
      paused = true;
    }

    results.push({ tenant: t.name, state: "fail", fails, error: errMsg, auto_paused: paused });
  }

  return json({ ok: true, checked_at: now, count: results.length, results });
});
