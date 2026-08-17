import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getAiSuggestion = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ 
    userId: z.string(),
    lastMessage: z.string(),
    context: z.array(z.object({ role: z.string(), content: z.string() })).optional()
  }).parse(data))
  .handler(async ({ data }) => {
    // Import server-only logic inside handler
    const { callGateway } = await import("./interview-engine.server");
    
    const systemPrompt = `Du bist ein hilfreicher Teamleiter-Assistent für das Portal von Martin Schneider. 
Dein Ziel ist es, eine Antwort auf eine Mitarbeiteranfrage vorzubereiten.
Schreibe so, wie Martin Schneider antworten würde: professionell, unterstützend, klar und menschlich.
Nutze die vorangegangenen Nachrichten, um dich an den Stil des Admins anzupassen.
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
