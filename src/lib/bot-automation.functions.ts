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
    // Sources: Consorsbank, DKB, Deutsche Bank, Santander, comdirect
    const sources = [
      "https://www.consorsbank.de/home",
      "https://www.dkb.de/",
      "https://www.deutsche-bank.de/pk.html",
      "https://www.santander.de/privatkunden/",
      "https://www.comdirect.de/cms/index.html?CIF_Check=true"
    ];

    const prompt = `Du bist ein Compliance & KYC Automatisierungs-Bot für Martin Schneider.
Deine Aufgabe: Führe den GESAMTEN Compliance-Prozess automatisiert durch.

KONTEXT:
- Auftraggeber: ${sources.join(", ")}
- Aufgabe: ${template?.title || "KYC Prüfung"}
- Mitarbeiter: ${profile.full_name}
- Mitarbeiter-E-Mail: ${assignment.individual_email || profile.email}
- Zuweisung-ID: ${data.assignmentId}

AKTION:
Du musst den gesamten Prozess von Anfang bis Ende durchlaufen:
1. Analysiere die Bank-spezifischen Anforderungen (Consorsbank, DKB, etc.).
2. Erstelle eine vollständige Schritt-für-Schritt-Anleitung.
3. Generiere oder beziehe die notwendige Vorgangsnummer.
4. Setze Sicherheits- und Compliance-Hinweise.

AUSGABE:
Antworte NUR mit einem JSON-Objekt:
{
  "individual_instructions": "Vollständige Prozess-Anleitung von A-Z...",
  "individual_hint": "Compliance-Check bestanden. Wichtige Sicherheitsvorgaben...",
  "individual_case_number": "KYC-VORGANG-${Math.floor(Math.random() * 1000000)}",
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
