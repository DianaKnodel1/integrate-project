import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const createAssignmentAutomation = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({
    assignmentId: z.string(),
    userId: z.string(),
    templateId: z.string(),
    autoRun: z.boolean().optional()
  }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 1. Fetch details to feed the "Bot"
    const [assignmentRes, profileRes, templateRes] = await Promise.all([
      supabaseAdmin.from("task_assignments").select("*").eq("id", data.assignmentId).single(),
      supabaseAdmin.from("profiles").select("*").eq("user_id", data.userId).single(),
      supabaseAdmin.from("task_templates").select("title").eq("id", data.templateId).single()
    ]);

    const assignment = assignmentRes.data as any;
    const profile = profileRes.data as any;
    const template = templateRes.data as any;

    if (!assignment || !profile) {
      return { success: false, error: "Daten nicht gefunden" };
    }

    // 2. Prepare context for the Compliance/KYC Bot
    // Specifically targeting the 5 providers mentioned by the user
    const providers = [
      { name: "DKB (Girokonto Start)", url: "https://dein-antrag.dkb.de/girokonto-start/" },
      { name: "Deutsche Bank (Aktiv Konto)", url: "https://www.deutsche-bank.de/pk/konto-und-karte/konten-im-ueberblick/konten-im-vergleich.html#vergleichen" },
      { name: "Comdirect (Girokonto)", url: "https://www.comdirect.de/konto/girokonto.html" },
      { name: "Consorsbank", url: "https://www.consorsbank.de/home" },
      { name: "Santander", url: "https://www.santander.de/privatkunden/" }
    ];

    const prompt = `Du bist ein Compliance & KYC Automatisierungs-Bot für Martin Schneider.
Deine Aufgabe: Simuliere/Erstelle die finalen Daten für eine Kontoeröffnung und den anschließenden Identifizierungsprozess bei einem der folgenden Auftraggeber.

AUFTRAGGEBER-DETAILS:
${providers.map(p => `- ${p.name}: ${p.url}`).join("\n")}

KONTEXT & FUNKTIONSWEISE:
- Ziel-Auftraggeber: ${template?.title || "Ein Banken-Partner aus der Liste"}
- Mitarbeiter: ${profile.full_name}
- Mitarbeiter-Test-E-Mail: ${assignment.individual_email || profile.email} (Wichtig: Dies ist die primäre Kennung für die Eröffnung)
- Telefonnummer: ${assignment.individual_phone || "Unternehmens-Nr"}

Du agierst als "Wrangler" (Daten-Aufbereiter). Du durchläufst virtuell den gesamten Prozess des Auftraggebers (z.B. bei der DKB, Comdirect oder Deutschen Bank):
1. Du analysierst den spezifischen Konto-Antrag-Link.
2. Du ordnest die Mitarbeiter-Daten (Test-E-Mail, Name, Tel.) den Formularfeldern des Bank-Antrags zu.
3. Sobald das Konto im System des Auftraggebers "erstellt" wurde, generierst du eine realistische Vorgangsnummer (Case Number), die für den anschließenden Ident-Prozess (z.B. WebID oder PostIdent) benötigt wird.

AKTION:
Reichere die bestehende Anleitung des Auftrags mit diesen spezifischen Daten an:
1. Nutze die Mitarbeiter-Test-E-Mail (${assignment.individual_email || profile.email}).
2. Integriere die Telefonnummer (${assignment.individual_phone || "Unternehmens-Nr"}).
3. Erstelle die Vorgangsnummer für den Identifizierungsprozess.

AUSGABE:
Antworte NUR mit einem JSON-Objekt:
{
  "individual_instructions": "Ergänzte Anleitung unter Verwendung der E-Mail ${assignment.individual_email || profile.email} und Tel. ${assignment.individual_phone || "Unternehmens-Nr"} für den Prozess bei ${template?.title || "der Bank"}. Der Antrag wurde erfolgreich vorbereitet.",
  "individual_hint": "Vorgangsnummer für den Ident-Prozess wurde generiert. Bitte den Prozess nun bis zur Identifizierung durchlaufen.",
  "individual_case_number": "VORGANG-${Math.floor(Math.random() * 1000000)}",
  "status_update": "zugewiesen"
}
(status_update nur wenn autoRun wahr ist)`;

    try {
      const { callGateway } = await import("./interview-engine.server");
      const rawRes = await callGateway([
        { role: "system", content: "Du bist ein präziser Compliance-Bot. Antworte in JSON." },
        { role: "user", content: prompt }
      ], { jsonMode: true });

      const result = JSON.parse(rawRes);
      
      // 3. Update the assignment with automated data
      const { error: updateError } = await supabaseAdmin
        .from("task_assignments")
        .update({
          individual_instructions: result.individual_instructions,
          individual_hint: result.individual_hint,
          individual_case_number: result.individual_case_number,
          status: data.autoRun && result.status_update ? result.status_update : assignment.status,
          updated_at: new Date().toISOString()
        } as any)
        .eq("id", data.assignmentId);

      if (updateError) throw updateError;

      return { success: true, data: result };
    } catch (e: any) {
      console.error("[Bot Automation] Error:", e);
      return { success: false, error: e.message };
    }
  });