import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import PortalAuthShell from "@/components/portal/PortalAuthShell";
import { usePortalTheme } from "@/hooks/use-portal-theme";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const t = usePortalTheme().tokens;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    // Tenant-SMTP-Versand statt Supabase-Auth-Default (eigene Domain & Reputation).
    const { error } = await supabase.functions.invoke("send-password-reset", {
      body: { email: email.trim(), host: window.location.hostname },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    // Immer Erfolg anzeigen — keine User-Enumeration.
    setSent(true);
  };

  if (sent) {
    return (
      <PortalAuthShell
        title="E-Mail gesendet"
        description="Wenn ein Konto mit dieser E-Mail existiert, erhältst du einen Link zum Zurücksetzen deines Passworts. Der Link ist 24 Stunden gültig und einmalig nutzbar."
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <p className={t.subText}>Prüfe dein Postfach — auch den Spam-Ordner.</p>
        </div>
        <Button variant="outline" className={t.secondaryButton} onClick={() => navigate("/login")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Zurück zum Login
        </Button>
      </PortalAuthShell>
    );
  }

  return (
    <PortalAuthShell
      title="Passwort vergessen"
      description="Gib deine E-Mail ein und wir senden dir einen Reset-Link."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className={t.label}>E-Mail</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="max@beispiel.de"
            className={t.input}
            required
          />
        </div>
        <Button type="submit" className={t.primaryButton} disabled={loading}>
          {loading ? "Wird gesendet…" : "Reset-Link senden"}
        </Button>
      </form>
      <p className="text-center">
        <button onClick={() => navigate("/login")} className={`${t.mutedText} hover:underline`}>
          ← Zurück zum Login
        </button>
      </p>
    </PortalAuthShell>
  );
}

