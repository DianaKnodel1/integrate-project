import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getAiSuggestion = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ 
    userId: z.string(),
    lastMessage: z.string(),
    context: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
    teamLeaderName: z.string().optional()
  }).parse(data))
  .handler(async ({ data }) => {
    // Import server-only logic inside handler
    const { callGateway } = await import("./interview-engine.server");
    
    const recruiterName = data.teamLeaderName || "Martin Schneider";
    
    const systemPrompt = `Du bist ein hilfreicher Teamleiter-Assistent für das Portal von ${recruiterName}. 
Dein Ziel ist es, eine Antwort auf eine Mitarbeiteranfrage vorzubereiten.
Schreibe so, wie ${recruiterName} antworten würde: professionell, unterstützend, klar und menschlich.

WICHTIG (Compliance/KYC):
Wenn es um Aufträge oder Testungen bei Banken geht (Consorsbank, DKB, Deutsche Bank, Santander, comdirect), achte auf strikte Compliance-Vorgaben. 
Erinnere Mitarbeiter ggf. an die Bot-Automatisierung im Auftrags-Detail, falls Daten fehlen oder sie Fragen zum KYC-Prozess haben.

Dein vollautomatisierter Bot agiert als "Wrangler": Er bereitet die Kontoeröffnung bei den 5 Auftraggebern (DKB, Deutsche Bank, Comdirect, Consorsbank, Santander) vor. Er durchläuft virtuell den Antragsprozess, ordnet die Mitarbeiter-E-Mail und Telefonnummer den Feldern zu und generiert nach der "Eröffnung" die nötige Vorgangsnummer für den Ident-Prozess. So übernimmt der Bot die mühsame Dateneingabe und stellt sicher, dass alles für den Mitarbeiter bereit ist. Das System verknüpft diese Daten automatisch mit dem WebID-Modul, sodass der Mitarbeiter direkt zur Identifizierung weitergeleitet wird.

Nutze die vorangegangenen Nachrichten und die Reaktionen des Admins, um dich an den Schreibstil des Admins anzupassen. Wenn der Admin Antworten anpasst oder korrigiert, lerne daraus für zukünftige Vorschläge. ${recruiterName} bevorzugt eine direkte, unterstützende Kommunikation per "Du".

Antworte NUR mit dem Antwortvorschlag, ohne Einleitung oder Kommentare.
Verwende das "Du" in der Anrede.`;


    const msgs = [
      { role: "system", content: systemPrompt },
      ...(data.context || []),
      { role: "user", content: data.lastMessage }
    ];

    try {
      const suggestion = await callGateway(msgs);
      return { suggestion: suggestion.trim() };
    } catch (e: any) {
      console.error("[AI Suggestion] Error:", e);
      return { suggestion: "Fehler bei der KI-Generierung." };
    }
  });