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

Der vollautomatisierte Bot übernimmt die Erstellung der Aufträge und holt sich die Vorgangsnummern basierend auf den vom Admin vorgegebenen Mitarbeiterdaten (insbesondere der E-Mail).

Nutze die vorangegangenen Nachrichten, um dich an den Schreibstil des Admins anzupassen.
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
