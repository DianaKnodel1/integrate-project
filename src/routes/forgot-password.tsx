import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail } from "lucide-react";
import PortalAuthShell from "@/components/portal/PortalAuthShell";
import { usePortalTheme } from "@/hooks/use-portal-theme";

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const t = usePortalTheme().tokens;

  // Mail-los-Modus: Das Portal verschickt keine Mails — auch keine Reset-Links.
  // Ein neues Passwort wird auf Anfrage manuell vergeben.
  return (
    <PortalAuthShell
      title="Passwort vergessen"
      description="Ein neues Passwort kann direkt bei deinem Ansprechpartner angefordert werden."
    >
      <div className="flex items-start gap-3">
        <Mail className="h-5 w-5 shrink-0 mt-0.5" />
        <p className={t.subText}>
          Schreib deinem Ansprechpartner kurz per E-Mail, dass du keinen Zugang mehr
          hast — du bekommst dann ein neues Passwort für dein Konto.
        </p>
      </div>
      <Button variant="outline" className={t.secondaryButton} onClick={() => navigate("/login")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Zurück zum Login
      </Button>
    </PortalAuthShell>
  );
}

