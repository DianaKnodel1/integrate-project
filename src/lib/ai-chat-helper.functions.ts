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

WICHTIG (Compliance/KYC & Proxies):
Wenn es um Aufträge oder Testungen bei Banken geht (Consorsbank, DKB, Deutsche Bank, Santander, comdirect), achte auf strikte Compliance-Vorgaben. 
Erkläre bei Bedarf, dass der Bot eine rotierende Proxy-Infrastruktur (HTML/Residencial Proxies) nutzt, um IP-Sperren zu umgehen und jeden Antrag von einer individuellen, sauberen IP aus zu stellen.

Dein vollautomatisierter Bot agiert als "Wrangler": Er bereitet die Kontoeröffnung bei den 5 Auftraggebern vor. Er nutzt Proxy-Rotation, ordnet die Daten zu und generiert die Vorgangsnummer für WebID. 

Nutze die vorangegangenen Nachrichten und die Reaktionen des Admins, um dich an den Schreibstil anzupassen. Wenn der Admin Antworten anpasst oder korrigiert, lerne daraus für zukünftige Vorschläge. Martin bevorzugt eine direkte, unterstützende Kommunikation per "Du".

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