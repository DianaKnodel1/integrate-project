import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Schema = z.object({ tenant_id: z.string().uuid() });

/**
 * Server-seitiger Fallback für den SMTP-Test.
 *
 * Warum: Der Browser-Aufruf `supabase.functions.invoke("smtp-test")` scheitert
 * mit „Failed to send a request to the Edge Function“, sobald die Funktion vom
 * Browser aus nicht erreichbar ist (CORS, Netz, veralteter Deploy). Dieser Weg
 * ruft dieselbe Funktion vom Portal-Server aus auf — ohne Browser-Netzpfad.
 */
export const runSmtpTestServerSide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const baseUrl = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    // Die Edge Function prüft die Admin-Rolle anhand des Benutzer-Tokens –
    // deshalb wird genau der Token des Aufrufers weitergereicht.
    const userToken = (getRequest()?.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!baseUrl || !apiKey || !userToken) {
      return {
        success: false as const,
        error: "Backend-Konfiguration fehlt (URL oder Service-Key) — Prüf-Funktion nicht aufrufbar.",
        errorCode: "CONFIG_ERROR",
        reachable: false,
      };
    }

    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/functions/v1/smtp-test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify({ tenant_id: data.tenant_id }),
      });
      const text = await res.text().catch(() => "");
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!body) {
        // 502 ohne JSON = die Prüfung lief zu lange und wurde von der
        // Laufzeitumgebung abgebrochen. Das ist fast immer ein SMTP-Timeout,
        // kein fehlendes Deployment.
        if (res.status === 502 || res.status === 504) {
          return {
            success: false as const,
            error:
              "SMTP-Server hat nicht rechtzeitig geantwortet – Host, Port und Firewall prüfen (Zeitüberschreitung beim Verbindungsaufbau). Die Mail-Pause ist nicht die Ursache: sie blockiert den Test nicht.",
            errorCode: "TIMEOUT",
            reachable: true,
          };
        }
        return {
          success: false as const,
          error: `Prüf-Funktion antwortete unerwartet (HTTP ${res.status}). Vermutlich ist die Backend-Funktion nicht deployed.`,
          errorCode: "FUNCTION_UNREACHABLE",
          reachable: false,
        };
      }
      return { ...body, reachable: true };
    } catch (e: any) {
      return {
        success: false as const,
        error: `Prüf-Funktion nicht erreichbar: ${String(e?.message ?? e)}`,
        errorCode: "FUNCTION_UNREACHABLE",
        reachable: false,
      };
    }
  });