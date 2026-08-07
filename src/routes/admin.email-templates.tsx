import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/email-templates")({
  component: AdminEmailTemplatesPage,
});

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { Mail, Save, Send, Eye, AlertTriangle, CheckCircle2, Copy, Loader2, Activity, AlertOctagon, Route as RouteIcon } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { dryRunApplicationReceived, listLandingPagesForDryRun } from "@/lib/application-dryrun.functions";
import { dryRunFlows, listAllFlows } from "@/lib/all-flows-dryrun.functions";
import { SuppressedRecipientsPanel } from "@/components/admin/SuppressedRecipientsPanel";
import { RoutingAuditPanel } from "@/components/admin/RoutingAuditPanel";


// Defaults für Reminder-Templates — 1:1 gespiegelt zu den Edge-Function-Defaults.
// Source of Truth ist der jeweilige Kommentar am Edge-Function-Konstantennamen.
const REMINDER_DEFAULTS = {
  // send-invitation-email → DEFAULT_WELCOME_TEMPLATE (Fast-Track Zusage)
  employee_signup: {
    subject: "Willkommen im Team – Ihre Registrierung in 5 Minuten",
    body: `Hallo {{first_name}},\n\nherzlichen Glückwunsch – Ihr Profil hat uns überzeugt.\n\nDamit Sie direkt starten können, ist nur noch ein Schritt nötig: die Registrierung im Mitarbeiter-Portal.\n\nWas Sie brauchen (bitte bereithalten):\n• Personalausweis oder Reisepass\n• IBAN (Bankverbindung für die Gehaltszahlung)\n• Steuer-Identifikationsnummer (11-stellig, steht auf Ihrem Lohnsteuerbescheid)\n• Sozialversicherungsnummer (falls vorhanden)\n\nWie geht es weiter?\n1. Portal-Registrierung abschließen (ca. 5 Minuten)\n2. Arbeitsvertrag digital unterschreiben\n3. Sofort loslegen – Aufträge stehen bereit\n\n{{cta:Jetzt registrieren|{{portal_link}}}}\n\nBei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.\n\nHerzliche Grüße\n{{sender_name}}`,
  },
  // send-invitation-email → DEFAULT_APPLICATION_RECEIVED_TEMPLATE
  application_received: {
    subject: "Bewerbung eingegangen – nächster Schritt",
    body: `Hallo {{first_name}},\n\nvielen Dank für Ihre Bewerbung bei {{tenant_name}}. Wir haben Ihre Angaben erhalten.\n\nDamit wir Sie persönlich kennenlernen können, wählen Sie bitte jetzt Ihren Termin für das Bewerbungsgespräch aus:\n\n{{cta:{{application_received_button_label}}|{{booking_link}}}}\n\nFalls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:\n{{booking_link}}\n\nSollten Sie bereits einen Termin gebucht haben, müssen Sie nichts weiter tun.\n\nHerzliche Grüße\n{{sender_name}}`,
    button: "Jetzt Termin buchen",
  },
  // send-reminders → confirm-Reminder
  confirm: {
    subject: "Bitte bestätige deine E-Mail – {{tenant_name}}",
    body: `Wir haben deine Bestätigung für {{email}} noch nicht erhalten. Bitte bestätige deine E-Mail, damit du dich anmelden kannst.\n\n{{cta:E-Mail bestätigen|{{confirmation_link}}}}\n\nOder kopiere diesen Link: {{confirmation_link}}`,
  },
  // send-reminders → completion-Reminder
  completion: {
    subject: "Bitte schließe deine Registrierung ab – {{tenant_name}}",
    body: `Hallo {{first_name}},\n\nin deinem Account bei {{tenant_name}} fehlen noch ein paar Angaben (z.B. Personalausweis, Arbeitsvertrag oder Pflichtdaten). Bitte melde dich an und vervollständige dein Profil.\n\n{{cta:Jetzt vervollständigen|{{login_link}}}}\n\nLogin: {{login_link}}`,
  },
  // send-reminders → no_booking (Mitarbeiter, 7 Tage ohne Auftrag)
  no_booking: {
    subject: "Neue Aufträge warten auf dich – {{tenant_name}}",
    body: `Hallo {{first_name}},\n\ndu hast seit über 7 Tagen keine Aufträge mehr bei {{tenant_name}} gebucht. Im Portal warten freie Termine — sichere dir jetzt deinen nächsten Einsatz.\n\n{{cta:Aufträge ansehen|{{booking_link}}}}\n\nOder kopiere diesen Link: {{booking_link}}`,
  },
  // send-reminders → recovery_mitarbeiter (Domain-Wechsel)
  recovery_mitarbeiter: {
    subject: "Wir sind umgezogen – dein neuer Portal-Link für {{tenant_name}}",
    body: `Hallo {{first_name}},\n\nwir haben eine neue Online-Adresse! Dein Mitarbeiter-Portal von {{tenant_name}} findest du ab sofort unter einer neuen URL.\n\nDeine Zugangsdaten bleiben unverändert – einfach mit der neuen Adresse einloggen, weitermachen mit Aufträgen, Onboarding-Schritten und Vertragsunterlagen wie gewohnt.\n\n{{cta:Zum neuen Portal|{{portal_link}}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link:\n{{portal_link}}\n\nViele Grüße\nDein {{tenant_name}}-Team`,
  },
  // send-chat-reminder
  chat: {
    subject: "Neue Nachricht von {{team_leader_name}} – {{tenant_name}}",
    body: `Hi {{first_name}},\n\ndu hast {{unread_count}} ungelesene Nachricht(en) von {{team_leader_name}} im Mitarbeiter-Portal.\n\nBitte logge dich kurz ein und antworte – so geht's für dich am schnellsten weiter.\n\n{{cta:Jetzt einloggen|{{login_link}}}}\n\nFalls der Button nicht funktioniert: {{login_link}}`,
  },
  // send-application-reminders → DEFAULTS.no_booking
  app_no_booking: {
    subject: "Erinnerung: Dein Termin bei {{tenant_name}} steht noch aus",
    body: `Hallo {{first_name}},\n\nvielen Dank für deine Bewerbung bei {{tenant_name}}. Damit wir dich kennenlernen können, fehlt nur noch dein Wunschtermin für das kurze Erstgespräch.\n\n{{cta:Jetzt Termin auswählen|{{calendly_link}}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link:\n{{calendly_link}}\n\nViele Grüße\n{{recruiter_name}}\n{{tenant_name}}`,
  },
  // send-application-reminders → DEFAULTS.no_show
  app_no_show: {
    subject: "Schade, dass es nicht geklappt hat – buche einen neuen Termin",
    body: `Hallo {{first_name}},\n\nleider konnten wir dich zu deinem Termin am {{appointment_date}} um {{appointment_time}} Uhr nicht erreichen. Kein Problem – wir hätten dich gern trotzdem kennengelernt.\n\nBitte wähle einen neuen Wunschtermin, der besser passt:\n\n{{cta:Neuen Termin auswählen|{{calendly_link}}}}\n\nFalls du Fragen hast oder Unterstützung brauchst, antworte einfach auf diese E-Mail.\n\nViele Grüße\n{{recruiter_name}}\n{{tenant_name}}`,
  },
  // send-application-reminders → DEFAULTS.registration
  app_registration: {
    subject: "Ihr Portal-Zugang wartet – nur noch ein Klick, {{first_name}}",
    body: `Hallo {{first_name}},\n\nherzlichen Glückwunsch nochmal zu Ihrer Zusage bei {{tenant_name}}.\n\nUns ist aufgefallen, dass Sie sich noch nicht im Mitarbeiter-Portal registriert haben. Erst mit der Registrierung können wir Ihren Arbeitsvertrag bereitstellen und Sie erhalten Zugriff auf Ihre ersten Aufträge.\n\nDie Registrierung dauert nur 2 Minuten:\n\n{{cta:Jetzt im Portal registrieren|{{portal_link}}}}\n\nFalls der Button nicht funktioniert, kopieren Sie diesen Link:\n{{portal_link}}\n\nBei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.\n\nHerzliche Grüße\n{{recruiter_name}}\n{{tenant_name}}`,
  },
  // send-application-reminders → DEFAULTS.rebook (neuer Termin nach Cancel)
  rebook_after_cancel: {
    subject: "Ihr Termin wurde abgesagt – bitte wählen Sie einen neuen",
    body: `Hallo {{first_name}},\n\nIhr geplanter Termin bei {{tenant_name}} wurde abgesagt. Wir würden Sie trotzdem sehr gerne kennenlernen und laden Sie ein, einen neuen Wunschtermin zu wählen.\n\n{{cta:Neuen Termin auswählen|{{calendly_link}}}}\n\nFalls der Button nicht funktioniert, kopieren Sie diesen Link:\n{{calendly_link}}\n\nBei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.\n\nHerzliche Grüße\n{{recruiter_name}}\n{{tenant_name}}`,
  },
  // send-appointment-reminders → DEFAULT_SUBJECT/BODY/BUTTON (30 Min vor Interview)
  bewerbung_magic_link: {
    subject: "In 30 Minuten startet Ihr Bewerbungsgespräch",
    body: `Hallo {{first_name}},\n\nkurze Erinnerung: In etwa 30 Minuten ({{appointment_time}} Uhr) startet Ihr Bewerbungsgespräch.\n\nSo läuft es ab:\n\n1. Kurzes Gespräch (ca. 10–15 Min)\n2. Bei positiver Bewertung erhalten Sie direkt eine Zusage per E-Mail\n3. Anschließend Registrierung im Mitarbeiter-Portal – Vertrag digital unterschreiben und loslegen\n\nBitte starten Sie das Gespräch über Ihren persönlichen Link:\n\n{{cta:{{button_label}}|{{magic_link}}}}\n\nTipp: Ruhige Umgebung, stabile Internet-Verbindung. Bei Problemen einfach auf diese E-Mail antworten.\n\nViel Erfolg und bis gleich!\n{{tenant_name}}`,
    button: "Bewerbungsgespräch starten",
  },
  // send-booking-confirmation → DEFAULT_SUBJECT/BODY/BUTTON
  booking_confirmation: {
    subject: "Termin bestätigt: {{appointment_date}}, {{appointment_time}} Uhr",
    body: `Hallo {{first_name}},\n\nvielen Dank – Ihr Termin für das Bewerbungsgespräch bei {{tenant_name}} ist fest reserviert:\n\nDatum: {{appointment_date}}\nUhrzeit: {{appointment_time}} Uhr\nDauer: ca. {{duration_minutes}} Minuten\n\nSie finden den Termin als Kalendereintrag (.ics) im Anhang – einfach öffnen und in Outlook, Google oder Apple-Kalender speichern.\n\n30 Minuten vor Beginn schicken wir Ihnen zusätzlich den direkten Link zum Gespräch, damit Sie ihn nicht extra suchen müssen.\n\nSollten Sie den Termin verschieben oder absagen müssen, tun Sie das jederzeit hier:\n\n{{cta:{{button_label}}|{{cancel_url}}}}\n\nWir freuen uns auf das Gespräch!\n\nHerzliche Grüße\n{{recruiter_name}}`,
    button: "Termin verwalten",
  },
};

interface TenantEmail {
  id: string;
  name: string;
  domain: string;
  primary_color: string | null;
  logo_url: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  welcome_email_subject: string | null;
  welcome_email_body: string | null;
  reset_email_subject: string | null;
  reset_email_body: string | null;
  email_signature: string | null;
  team_leader_name: string;
  company_email?: string | null;
  reminder_confirm_subject: string | null;
  reminder_confirm_body: string | null;
  reminder_completion_subject: string | null;
  reminder_completion_body: string | null;
  reminder_no_booking_subject: string | null;
  reminder_no_booking_body: string | null;
  reminder_recovery_subject: string | null;
  reminder_recovery_body: string | null;
  reminder_chat_subject: string | null;
  reminder_chat_body: string | null;
  reminder_app_no_booking_subject: string | null;
  reminder_app_no_booking_body: string | null;
  reminder_app_no_show_subject: string | null;
  reminder_app_no_show_body: string | null;
  reminder_app_registration_subject: string | null;
  reminder_app_registration_body: string | null;
  bewerbung_magic_link_subject: string | null;
  bewerbung_magic_link_body: string | null;
  bewerbung_magic_link_button: string | null;
  booking_confirmation_subject: string | null;
  booking_confirmation_body: string | null;
  booking_confirmation_button: string | null;
}

const PLACEHOLDERS = [
  { key: "first_name", label: "Vorname", preview: "Max" },
  { key: "last_name", label: "Nachname", preview: "Mustermann" },
  { key: "email", label: "E-Mail", preview: "max@example.com" },
  { key: "company_name", label: "Firmenname", preview: "TeamPortal" },
  { key: "portal_link", label: "Portal-Link", preview: "https://portal.example.com/register?token=abc" },
  { key: "team_leader_name", label: "Teamleiter", preview: "Anna Schmidt" },
  { key: "tenant_name", label: "Tenant-Name", preview: "BCU Beratung" },
  { key: "support_email", label: "Support-E-Mail", preview: "support@example.com" },
  { key: "reset_link", label: "Reset-Link", preview: "https://portal.example.com/reset-password?token=xyz" },
  { key: "login_link", label: "Login-Link", preview: "https://portal.example.com/login" },
  { key: "confirmation_link", label: "Bestätigungs-Link", preview: "https://portal.example.com/auth/confirmed?token_hash=…" },
  { key: "booking_link", label: "Aufträge-Link", preview: "https://portal.example.com/appointments" },
  { key: "sender_name", label: "Absender-Name", preview: "Max Geschäftsführer" },
];

function replacePlaceholders(text: string, tenant: TenantEmail): string {
  const map: Record<string, string> = {
    first_name: "Max",
    last_name: "Mustermann",
    email: "max@example.com",
    company_name: tenant.name,
    portal_link: `https://${tenant.domain}/register?token=demo123`,
    team_leader_name: tenant.team_leader_name,
    tenant_name: tenant.name,
    support_email: tenant.company_email || tenant.sender_email || "support@example.com",
    sender_name: tenant.sender_name || "Geschäftsführung",
    reset_link: `https://${tenant.domain}/reset-password?token=demo123`,
    login_link: `https://${tenant.domain}/login`,
    confirmation_link: `https://${tenant.domain}/auth/confirmed?token_hash=demo123`,
    booking_link: `https://${tenant.domain}/appointments`,
  };
  let result = text;
  for (const [key, value] of Object.entries(map)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  // CTA-Syntax: {{cta:Label|URL}} -> sichtbarer Button (in Vorschau)
  result = result.replace(/\{\{cta:([^|]+)\|([\s\S]*?)\}\}/g, (_m, label, href) => {
    const color = tenant.primary_color || "#0f172a";
    return `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`;
  });
  return result;
}

function generateEmailHtml(
  subject: string,
  body: string,
  signature: string,
  tenant: TenantEmail
): string {
  const color = tenant.primary_color || "#000000";
  const resolvedBody = replacePlaceholders(body, tenant);
  const resolvedSignature = replacePlaceholders(signature, tenant);

  // Bereits gerenderte <a>-Tags (aus CTA-Buttons) vor Auto-Linkify schützen,
  // sonst wird die URL im href="..." erneut umschlossen und das Tag zerrissen.
  const anchors: string[] = [];
  const bodyHtml = resolvedBody
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => {
      anchors.push(m);
      return `\u0000A${anchors.length - 1}\u0000`;
    })
    .replace(/\n/g, "<br>")
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`
    )
    .replace(/\u0000A(\d+)\u0000/g, (_m, i) => anchors[Number(i)] ?? "");

  const logoHtml = tenant.logo_url
    ? `<div style="text-align:center;margin-bottom:24px;"><img src="${tenant.logo_url}" alt="${tenant.name}" style="max-height:48px;max-width:200px;" /></div>`
    : "";

  const sigHtml = resolvedSignature
    ? `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:13px;line-height:20px;">${resolvedSignature.replace(/\n/g, "<br>")}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<div style="background:#ffffff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${logoHtml}
<h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.3;">
${replacePlaceholders(subject, tenant)}
</h1>
<div style="color:#374151;font-size:15px;line-height:26px;">
${bodyHtml}
</div>
${sigHtml}
</div>
<div style="text-align:center;margin-top:16px;color:#9ca3af;font-size:11px;">
© ${new Date().getFullYear()} ${tenant.name}
</div>
</div>
</body>
</html>`;
}

function PlaceholderChips({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {PLACEHOLDERS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onInsert(`{{${p.key}}}`)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
          title={`${p.label} einfügen`}
        >
          <Copy className="h-3 w-3" />
          {`{{${p.key}}}`}
        </button>
      ))}
    </div>
  );
}

function TemplateEditor({
  label,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  signature,
  onSignatureChange,
  tenant,
}: {
  label: string;
  subject: string;
  onSubjectChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  signature: string;
  onSignatureChange: (v: string) => void;
  tenant: TenantEmail;
}) {
  const [showPreview, setShowPreview] = useState(true);
  const previewHtml = useMemo(
    () => generateEmailHtml(subject, body, signature, tenant),
    [subject, body, signature, tenant]
  );

  const insertIntoBody = (placeholder: string) => {
    onBodyChange(body + placeholder);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Editor */}
      <div className="space-y-4">
        <div>
          <Label className="text-xs font-medium">Betreff</Label>
          <Input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="E-Mail Betreff…"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Inhalt</Label>
          <Textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="E-Mail Text…"
            className="mt-1 min-h-[200px] font-mono text-sm"
            rows={10}
          />
          <p className="text-[11px] text-muted-foreground mt-1">Platzhalter anklicken zum Einfügen:</p>
          <PlaceholderChips onInsert={insertIntoBody} />
        </div>
        <div>
          <Label className="text-xs font-medium">Signatur</Label>
          <Textarea
            value={signature}
            onChange={(e) => onSignatureChange(e.target.value)}
            placeholder="Herzliche Grüße,&#10;Dein {{company_name}}-Team"
            className="mt-1 min-h-[80px] text-sm"
            rows={3}
          />
        </div>
      </div>

      {/* Preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Vorschau
          </Label>
          <Badge variant="secondary" className="text-[10px]">Live-Vorschau</Badge>
        </div>
        <div className="border rounded-xl overflow-hidden bg-muted/30">
          <iframe
            srcDoc={previewHtml}
            className="w-full h-[500px] border-0"
            title="E-Mail Vorschau"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}

function AdminEmailTemplatesPage() {
  const [tenants, setTenants] = useState<TenantEmail[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [limitedTemplateMode, setLimitedTemplateMode] = useState(false);
  type TestTemplateKey = "employee_signup" | "reset" | "confirm" | "completion" | "no_booking" | "recovery_ma" | "chat" | "magic_link" | "application_received" | "booking_confirmation" | "app_no_booking" | "app_no_show" | "app_registration";
  const [testType, setTestType] = useState<TestTemplateKey>("employee_signup");
  const [bulkResults, setBulkResults] = useState<Array<{ key: TestTemplateKey; label: string; ok: boolean; error?: string }>>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const { toast } = useToast();

  // Template state
  const [employeeSignupSubject, setEmployeeSignupSubject] = useState("");
  const [employeeSignupBody, setEmployeeSignupBody] = useState("");
  const [resetSubject, setResetSubject] = useState("");
  const [resetBody, setResetBody] = useState("");
  const [signature, setSignature] = useState("");
  const [senderName, setSenderName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  // Reminder-Templates
  const [rConfirmSubject, setRConfirmSubject] = useState("");
  const [rConfirmBody, setRConfirmBody] = useState("");
  const [rCompletionSubject, setRCompletionSubject] = useState("");
  const [rCompletionBody, setRCompletionBody] = useState("");
  const [rNoBookingSubject, setRNoBookingSubject] = useState("");
  const [rNoBookingBody, setRNoBookingBody] = useState("");
  const [rRecoveryMaSubject, setRRecoveryMaSubject] = useState("");
  const [rRecoveryMaBody, setRRecoveryMaBody] = useState("");
  const [rChatSubject, setRChatSubject] = useState("");
  const [rChatBody, setRChatBody] = useState("");
  const [rAppNoBookingSubject, setRAppNoBookingSubject] = useState("");
  const [rAppNoBookingBody, setRAppNoBookingBody] = useState("");
  const [rAppNoShowSubject, setRAppNoShowSubject] = useState("");
  const [rAppNoShowBody, setRAppNoShowBody] = useState("");
  const [rAppRegSubject, setRAppRegSubject] = useState("");
  const [rAppRegBody, setRAppRegBody] = useState("");
  const [mlSubject, setMlSubject] = useState("");
  const [mlBody, setMlBody] = useState("");
  const [mlButton, setMlButton] = useState("");
  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcButton, setBcButton] = useState("");

  const loadTenants = async () => {
    setLoading(true);
    const FULL_COLS = "id, name, domain, primary_color, logo_url, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, welcome_email_subject, welcome_email_body, reset_email_subject, reset_email_body, email_signature, team_leader_name, reminder_confirm_subject, reminder_confirm_body, reminder_completion_subject, reminder_completion_body, reminder_no_booking_subject, reminder_no_booking_body, reminder_recovery_subject, reminder_recovery_body, reminder_chat_subject, reminder_chat_body, reminder_app_no_booking_subject, reminder_app_no_booking_body, reminder_app_no_show_subject, reminder_app_no_show_body, reminder_app_registration_subject, reminder_app_registration_body, bewerbung_magic_link_subject, bewerbung_magic_link_body, bewerbung_magic_link_button, booking_confirmation_subject, booking_confirmation_body, booking_confirmation_button";
    const FALLBACK_COLS = "id, name, domain, primary_color, logo_url, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, welcome_email_subject, welcome_email_body, reset_email_subject, reset_email_body, email_signature, team_leader_name, reminder_confirm_subject, reminder_confirm_body, reminder_completion_subject, reminder_completion_body, reminder_no_booking_subject, reminder_no_booking_body, reminder_recovery_subject, reminder_recovery_body, reminder_chat_subject, reminder_chat_body";

    setLimitedTemplateMode(false);
    let { data, error } = await (supabase as any).from("tenants").select(FULL_COLS).order("name");

    if (error) {
      console.warn("[email-templates] Full select fehlgeschlagen, Fallback wird versucht:", error.message);
      const retry = await (supabase as any).from("tenants").select(FALLBACK_COLS).order("name");
      data = retry.data;
      if (retry.error) {
        toast({
          title: "Tenants konnten nicht geladen werden",
          description: retry.error.message,
          variant: "destructive",
        });
        setTenants([]);
        setLoading(false);
        return;
      }
      setLimitedTemplateMode(true);
      toast({
        title: "Vermittlungs-Template-Felder fehlen",
        description: "Bitte die neuen Tenant-Spalten migrieren; die Seite läuft bis dahin ohne Speichern der Vermittlungs-Vorlagen.",
      });
    }

    const rows = (data as TenantEmail[] | null) ?? [];
    setTenants(rows);
    if (rows.length > 0 && !selectedTenantId) {
      setSelectedTenantId(rows[0].id);
      loadTenantData(rows[0]);
    }
    setLoading(false);
  };

  const loadTenantData = (t: TenantEmail) => {
    setEmployeeSignupSubject(t.welcome_email_subject || REMINDER_DEFAULTS.employee_signup.subject);
    setEmployeeSignupBody(
      t.welcome_email_body ||
        REMINDER_DEFAULTS.employee_signup.body
    );
    setResetSubject(t.reset_email_subject || "Passwort zurücksetzen");
    setResetBody(
      t.reset_email_body ||
        "Hallo {{first_name}},\n\ndu hast eine Anfrage zum Zurücksetzen deines Passworts gestellt.\n\nKlicke auf den folgenden Link, um dein Passwort zurückzusetzen:\n{{reset_link}}\n\nFalls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail.\n\nViele Grüße,\n{{company_name}}"
    );
    setSignature(t.email_signature || "");
    setSenderName(t.sender_name || "");
    setReplyTo(t.reply_to_email || "");
    setRConfirmSubject(t.reminder_confirm_subject || REMINDER_DEFAULTS.confirm.subject);
    setRConfirmBody(t.reminder_confirm_body || REMINDER_DEFAULTS.confirm.body);
    setRCompletionSubject(t.reminder_completion_subject || REMINDER_DEFAULTS.completion.subject);
    setRCompletionBody(t.reminder_completion_body || REMINDER_DEFAULTS.completion.body);
    setRNoBookingSubject(t.reminder_no_booking_subject || REMINDER_DEFAULTS.no_booking.subject);
    setRNoBookingBody(t.reminder_no_booking_body || REMINDER_DEFAULTS.no_booking.body);
    setRRecoveryMaSubject(t.reminder_recovery_subject || REMINDER_DEFAULTS.recovery_mitarbeiter.subject);
    setRRecoveryMaBody(t.reminder_recovery_body || REMINDER_DEFAULTS.recovery_mitarbeiter.body);
    setRChatSubject(t.reminder_chat_subject || REMINDER_DEFAULTS.chat.subject);
    setRChatBody(t.reminder_chat_body || REMINDER_DEFAULTS.chat.body);
    setRAppNoBookingSubject((t as any).reminder_app_no_booking_subject || REMINDER_DEFAULTS.app_no_booking.subject);
    setRAppNoBookingBody((t as any).reminder_app_no_booking_body || REMINDER_DEFAULTS.app_no_booking.body);
    setRAppNoShowSubject((t as any).reminder_app_no_show_subject || REMINDER_DEFAULTS.app_no_show.subject);
    setRAppNoShowBody((t as any).reminder_app_no_show_body || REMINDER_DEFAULTS.app_no_show.body);
    setRAppRegSubject((t as any).reminder_app_registration_subject || REMINDER_DEFAULTS.app_registration.subject);
    setRAppRegBody((t as any).reminder_app_registration_body || REMINDER_DEFAULTS.app_registration.body);
    setMlSubject((t as any).bewerbung_magic_link_subject || REMINDER_DEFAULTS.bewerbung_magic_link.subject);
    setMlBody((t as any).bewerbung_magic_link_body || REMINDER_DEFAULTS.bewerbung_magic_link.body);
    setMlButton((t as any).bewerbung_magic_link_button || REMINDER_DEFAULTS.bewerbung_magic_link.button);
    setBcSubject((t as any).booking_confirmation_subject || REMINDER_DEFAULTS.booking_confirmation.subject);
    setBcBody((t as any).booking_confirmation_body || REMINDER_DEFAULTS.booking_confirmation.body);
    setBcButton((t as any).booking_confirmation_button || REMINDER_DEFAULTS.booking_confirmation.button);
  };

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    const t = tenants.find((t) => t.id === selectedTenantId);
    if (t) loadTenantData(t);
  }, [selectedTenantId]);

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId);
  const smtpConfigured = !!(
    selectedTenant?.smtp_host &&
    selectedTenant?.smtp_username &&
    selectedTenant?.smtp_password &&
    selectedTenant?.sender_email
  );

  const handleSave = async () => {
    if (!selectedTenantId) return;
    setSaving(true);
    const updatePayload: Record<string, any> = {
        welcome_email_subject: employeeSignupSubject,
        welcome_email_body: employeeSignupBody,
        reset_email_subject: resetSubject,
        reset_email_body: resetBody,
        email_signature: signature,
        sender_name: senderName || null,
        reply_to_email: replyTo || null,
        reminder_confirm_subject: rConfirmSubject,
        reminder_confirm_body: rConfirmBody,
        reminder_completion_subject: rCompletionSubject,
        reminder_completion_body: rCompletionBody,
        reminder_no_booking_subject: rNoBookingSubject,
        reminder_no_booking_body: rNoBookingBody,
        reminder_recovery_subject: rRecoveryMaSubject,
        reminder_recovery_body: rRecoveryMaBody,
        reminder_chat_subject: rChatSubject,
        reminder_chat_body: rChatBody,
      };
    if (!limitedTemplateMode) {
      Object.assign(updatePayload, {
        reminder_app_no_booking_subject: rAppNoBookingSubject,
        reminder_app_no_booking_body: rAppNoBookingBody,
        reminder_app_no_show_subject: rAppNoShowSubject,
        reminder_app_no_show_body: rAppNoShowBody,
        reminder_app_registration_subject: rAppRegSubject,
        reminder_app_registration_body: rAppRegBody,
        bewerbung_magic_link_subject: mlSubject,
        bewerbung_magic_link_body: mlBody,
        bewerbung_magic_link_button: mlButton || null,
        booking_confirmation_subject: bcSubject,
        booking_confirmation_body: bcBody,
        booking_confirmation_button: bcButton || null,
      });
    }
    const { error } = await supabase
      .from("tenants")
      .update(updatePayload as any)
      .eq("id", selectedTenantId);
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Templates gespeichert" });
      loadTenants();
    }
  };

  const getTestTemplate = (key: TestTemplateKey): { subject: string; body: string } => {
    switch (key) {
      case "employee_signup": return { subject: employeeSignupSubject, body: employeeSignupBody };
      case "reset": return { subject: resetSubject, body: resetBody };
      case "confirm": return { subject: rConfirmSubject, body: rConfirmBody };
      case "completion": return { subject: rCompletionSubject, body: rCompletionBody };
      case "no_booking": return { subject: rNoBookingSubject, body: rNoBookingBody };
      case "recovery_ma": return { subject: rRecoveryMaSubject, body: rRecoveryMaBody };
      case "chat": return { subject: rChatSubject, body: rChatBody };
      case "magic_link": return { subject: mlSubject, body: mlBody };
      case "application_received": return { subject: employeeSignupSubject, body: employeeSignupBody };
      case "booking_confirmation": return { subject: bcSubject, body: bcBody };
      case "app_no_booking": return { subject: rAppNoBookingSubject, body: rAppNoBookingBody };
      case "app_no_show": return { subject: rAppNoShowSubject, body: rAppNoShowBody };
      case "app_registration": return { subject: rAppRegSubject, body: rAppRegBody };
    }
  };

  const ALL_TEST_TEMPLATES: Array<{ key: TestTemplateKey; label: string }> = [
    { key: "employee_signup", label: "Willkommen (Mitarbeiter)" },
    { key: "application_received", label: "Bewerbung eingegangen" },
    { key: "booking_confirmation", label: "Terminbestätigung" },
    { key: "magic_link", label: "Interview-Einladung (30 Min vorher)" },
    { key: "reset", label: "Passwort-Reset" },
    { key: "confirm", label: "Erinnerung: E-Mail bestätigen" },
    { key: "completion", label: "Erinnerung: Registrierung abschließen" },
    { key: "no_booking", label: "Erinnerung: Keine Buchung" },
    { key: "chat", label: "Chat-Reminder" },
    { key: "recovery_ma", label: "Domain-Wechsel (Mitarbeiter)" },
    { key: "app_no_booking", label: "Vermittlung: Kein Termin" },
    { key: "app_no_show", label: "Vermittlung: No-Show" },
    { key: "app_registration", label: "Vermittlung: Registrierung offen" },
  ];

  const sendOneTest = async (key: TestTemplateKey): Promise<{ ok: boolean; error?: string }> => {
    if (!testEmail || !selectedTenant) return { ok: false, error: "keine Empfänger-Adresse" };
    try {
      const { subject, body } = getTestTemplate(key);
      const isBewerbungMl = key === "magic_link";
      const templateName = isBewerbungMl ? "bewerbung_magic_link" : key;
      const { data, error } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: testEmail,
          fullName: "Test Benutzer",
          firstName: "Test",
          lastName: "Benutzer",
          registrationLink: `https://${selectedTenant.domain}/register?token=test`,
          tenantId: selectedTenantId,
          subject: subject ? `[TEST] ${replacePlaceholders(subject, selectedTenant)}` : `[TEST] ${key}`,
          intro: body || undefined,
          buttonLabel: isBewerbungMl ? mlButton : (key === "booking_confirmation" ? bcButton : undefined),
          templateName,
          placeholders: {
            sender_name: selectedTenant.sender_name || "Geschäftsführung",
            recruiter_name: selectedTenant.sender_name || "Sabine Schneider",
            partner_name: "Musterfirma GmbH",
            calendly_link: `https://${selectedTenant.domain}/termin`,
            booking_link: `https://${selectedTenant.domain}/termin`,
            portal_link: `https://${selectedTenant.domain}/portal`,
            login_link: `https://${selectedTenant.domain}/login`,
            confirmation_link: `https://${selectedTenant.domain}/confirm?token=test`,
            cancel_url: `https://${selectedTenant.domain}/termin/cancel?token=test`,
            appointment_date: "24.07.2026",
            appointment_time: "14:30",
            duration_minutes: "30",
            team_leader_name: selectedTenant.sender_name || "Team-Leitung",
            unread_count: "2",
            email: testEmail,
          },
        },
      });
      if (error) return { ok: false, error: error.message };
      if (data?.error) return { ok: false, error: String(data.error) };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  const handleTestAll = async () => {
    if (!testEmail || !selectedTenant) {
      toast({ title: "Empfänger fehlt", variant: "destructive" });
      return;
    }
    setBulkRunning(true);
    setBulkResults([]);
    const results: Array<{ key: TestTemplateKey; label: string; ok: boolean; error?: string }> = [];
    for (const tpl of ALL_TEST_TEMPLATES) {
      const res = await sendOneTest(tpl.key);
      results.push({ key: tpl.key, label: tpl.label, ...res });
      setBulkResults([...results]);
      // kleine Pause gegen SMTP-Rate-Limits
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulkRunning(false);
    const ok = results.filter((r) => r.ok).length;
    toast({
      title: `Sammel-Test abgeschlossen: ${ok}/${results.length} erfolgreich`,
      description: ok === results.length ? "Alle Templates erfolgreich versendet." : "Details siehe Liste.",
      variant: ok === results.length ? "default" : "destructive",
    });
  };


  const handleUseMyEmail = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) setTestEmail(data.user.email);
    else toast({ title: "Keine E-Mail gefunden", variant: "destructive" });
  };

  const handleTestSend = async () => {
    if (!testEmail || !selectedTenant) return;
    setTesting(true);
    try {
      const { subject, body } = getTestTemplate(testType);
      const html = generateEmailHtml(subject, body, signature, selectedTenant);

      const { data, error } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: testEmail,
          fullName: "Test Benutzer",
          firstName: "Test",
          lastName: "Benutzer",
          registrationLink: `https://${selectedTenant.domain}/register?token=test`,
          tenantId: selectedTenantId,
          subject: `[TEST] ${replacePlaceholders(subject, selectedTenant)}`,
          intro: body,
          buttonLabel: testType === "magic_link" ? mlButton : undefined,
          templateName: testType === "magic_link" ? "bewerbung_magic_link" : testType,
          placeholders: {
            sender_name: selectedTenant.sender_name || "Geschäftsführung",
          },
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Test-E-Mail gesendet", description: `An ${testEmail}` });
    } catch (err: any) {
      toast({ title: "Fehler beim Versand", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-5">
        <PageHeaderSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">E-Mail Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            E-Mail-Vorlagen pro Tenant verwalten und testen
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
            <SelectTrigger className="w-56 h-9 text-xs">
              <SelectValue placeholder="Tenant wählen…" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving || !selectedTenantId} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Speichern
          </Button>
        </div>
      </div>

      {/* SMTP Warning */}
      {selectedTenant && !smtpConfigured && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>SMTP nicht konfiguriert</strong> – E-Mail-Versand ist für diesen Tenant nicht möglich.
            Bitte zuerst unter <em>Domains</em> die SMTP-Einstellungen hinterlegen.
          </span>
        </div>
      )}

      {selectedTenant && smtpConfigured && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            SMTP aktiv: <strong>{selectedTenant.smtp_host}</strong> · Absender:{" "}
            <strong>{selectedTenant.sender_email}</strong>
          </span>
        </div>
      )}

      {/* Sender Settings */}
      {selectedTenant && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Absender-Einstellungen</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-5">
            <div>
              <Label className="text-xs">Absendername</Label>
              <Input
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder={selectedTenant.name}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Reply-To</Label>
              <Input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder={selectedTenant.sender_email || "reply@example.com"}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Template Tabs */}
      {selectedTenant && (
        <Tabs defaultValue="employee_signup" className="space-y-4">
          <TabsList>
            <TabsTrigger value="employee_signup" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Herzlichen Glückwunsch
            </TabsTrigger>
            <TabsTrigger value="reset" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Passwort zurücksetzen
            </TabsTrigger>
            <TabsTrigger value="reminders" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Erinnerungen
            </TabsTrigger>
            <TabsTrigger value="dryrun" className="text-xs gap-1.5">
              <Activity className="h-3.5 w-3.5" /> End-to-End Test
            </TabsTrigger>
            <TabsTrigger value="failed" className="text-xs gap-1.5">
              <AlertOctagon className="h-3.5 w-3.5" /> Gesperrte Empfänger
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs gap-1.5">
              <RouteIcon className="h-3.5 w-3.5" /> Routing-Audit
            </TabsTrigger>


          </TabsList>

          <TabsContent value="dryrun">
            <DryRunPanel />
          </TabsContent>

          <TabsContent value="failed">
            <SuppressedRecipientsPanel />
          </TabsContent>

          <TabsContent value="audit">
            <RoutingAuditPanel />
          </TabsContent>





          <TabsContent value="employee_signup">
            <TemplateEditor
              label="Herzlichen Glückwunsch"
              subject={employeeSignupSubject}
              onSubjectChange={setEmployeeSignupSubject}
              body={employeeSignupBody}
              onBodyChange={setEmployeeSignupBody}
              signature={signature}
              onSignatureChange={setSignature}
              tenant={selectedTenant}
            />
          </TabsContent>

          <TabsContent value="reset">
            <TemplateEditor
              label="Passwort zurücksetzen"
              subject={resetSubject}
              onSubjectChange={setResetSubject}
              body={resetBody}
              onBodyChange={setResetBody}
              signature={signature}
              onSignatureChange={setSignature}
              tenant={selectedTenant}
            />
          </TabsContent>

          <TabsContent value="reminders">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 mb-3 text-[12px] text-muted-foreground">
              Diese Mails verschickt das System automatisch abhängig vom jeweiligen Flow.
              Verwende <code>{`{{cta:Label|{{portal_link}}}}`}</code> für einen Button.
              Plain-Text wird automatisch in HTML umgewandelt.
            </div>
            <Tabs defaultValue="confirm" className="space-y-3">
              <TabsList>
                <TabsTrigger value="confirm" className="text-xs">E-Mail bestätigen</TabsTrigger>
                <TabsTrigger value="completion" className="text-xs">Registrierung abschließen</TabsTrigger>
                <TabsTrigger value="no_booking" className="text-xs">Keine Buchung (7 Tage)</TabsTrigger>
                <TabsTrigger value="recovery" className="text-xs">Domain-Wechsel</TabsTrigger>
                <TabsTrigger value="chat" className="text-xs">Chat-Reminder</TabsTrigger>
                <TabsTrigger value="app_no_booking" className="text-xs">Vermittlung: Kein Termin</TabsTrigger>
                <TabsTrigger value="app_no_show" className="text-xs">Vermittlung: No-Show</TabsTrigger>
                <TabsTrigger value="app_registration" className="text-xs">Vermittlung: Registrierung offen</TabsTrigger>
                <TabsTrigger value="magic_link" className="text-xs">Vermittlung: Interview-Einladung</TabsTrigger>
                <TabsTrigger value="booking_confirmation" className="text-xs">Terminbestätigung</TabsTrigger>
              </TabsList>
              <TabsContent value="confirm">
                <TemplateEditor
                  label="E-Mail-Bestätigungs-Erinnerung"
                  subject={rConfirmSubject} onSubjectChange={setRConfirmSubject}
                  body={rConfirmBody} onBodyChange={setRConfirmBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="completion">
                <TemplateEditor
                  label="Registrierung-Abschließen-Erinnerung"
                  subject={rCompletionSubject} onSubjectChange={setRCompletionSubject}
                  body={rCompletionBody} onBodyChange={setRCompletionBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="no_booking">
                <TemplateEditor
                  label="Keine-Buchung-Erinnerung"
                  subject={rNoBookingSubject} onSubjectChange={setRNoBookingSubject}
                  body={rNoBookingBody} onBodyChange={setRNoBookingBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="recovery">
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 mb-3 text-[11px] text-amber-900 dark:text-amber-200">
                  Einmaliger Versand pro Mitarbeiter, wenn du im Admin die <strong>primäre Portal-Domain</strong> wechselst. Bewerber laufen über die normale Einladungs-Erinnerung mit der aktuellen Portal-URL — kein eigenes Template nötig.
                </div>
                <TemplateEditor
                  label="Domain-Wechsel – Mitarbeiter"
                  subject={rRecoveryMaSubject} onSubjectChange={setRRecoveryMaSubject}
                  body={rRecoveryMaBody} onBodyChange={setRRecoveryMaBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="chat">
                <div className="rounded-md border border-violet-300 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-700 px-3 py-2 mb-3 text-[11px] text-violet-900 dark:text-violet-200">
                  Wird manuell aus dem <strong>Admin-Chat</strong> per Button „📨 Erinnerung senden" verschickt, wenn ein Mitarbeiter ungelesene Nachrichten hat. Rate-Limit: max. 1× pro 24 h pro Empfänger. Zusätzlicher Platzhalter: <code>{"{{unread_count}}"}</code>.
                </div>
                <TemplateEditor
                  label="Chat-Reminder"
                  subject={rChatSubject} onSubjectChange={setRChatSubject}
                  body={rChatBody} onBodyChange={setRChatBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="app_no_booking">
                <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700 px-3 py-2 mb-3 text-[11px] text-orange-900 dark:text-orange-200">
                  Wird automatisch an Vermittlungs-Bewerber gesendet, die sich beworben, aber noch <strong>keinen Termin gebucht</strong> haben (24h + 72h nach Bewerbung, Cron alle 30 Min). Enthält den Calendly-Link mit vor-ausgefüllter Bewerber-ID. Platzhalter: <code>{"{{first_name}}"}</code>, <code>{"{{calendly_link}}"}</code>, <code>{"{{recruiter_name}}"}</code>, <code>{"{{tenant_name}}"}</code>, <code>{"{{partner_name}}"}</code>.
                </div>
                <TemplateEditor
                  label="Bewerber ohne Terminbuchung"
                  subject={rAppNoBookingSubject} onSubjectChange={setRAppNoBookingSubject}
                  body={rAppNoBookingBody} onBodyChange={setRAppNoBookingBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="app_no_show">
                <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-700 px-3 py-2 mb-3 text-[11px] text-rose-900 dark:text-rose-200">
                  Wird <strong>24 Stunden nach einem verpassten Termin</strong> an den Bewerber gesendet mit einem neuen Calendly-Link (Cron alle 30 Min, max. 1× pro Buchung). Platzhalter: <code>{"{{first_name}}"}</code>, <code>{"{{appointment_date}}"}</code>, <code>{"{{appointment_time}}"}</code>, <code>{"{{calendly_link}}"}</code>, <code>{"{{recruiter_name}}"}</code>, <code>{"{{tenant_name}}"}</code>.
                </div>
                <TemplateEditor
                  label="Bewerber No-Show (24h)"
                  subject={rAppNoShowSubject} onSubjectChange={setRAppNoShowSubject}
                  body={rAppNoShowBody} onBodyChange={setRAppNoShowBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="app_registration">
                <div className="rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-700 px-3 py-2 mb-3 text-[11px] text-sky-900 dark:text-sky-200">
                  Wird an Bewerber gesendet, die eine <strong>Zusage erhalten</strong>, sich aber noch nicht im Mitarbeiter-Portal registriert haben (24h + 72h nach Einladung, Cron alle 30 Min). Platzhalter: <code>{"{{first_name}}"}</code>, <code>{"{{portal_link}}"}</code>, <code>{"{{recruiter_name}}"}</code>, <code>{"{{tenant_name}}"}</code>.
                </div>
                <TemplateEditor
                  label="Registrierung offen (24h/72h nach Zusage)"
                  subject={rAppRegSubject} onSubjectChange={setRAppRegSubject}
                  body={rAppRegBody} onBodyChange={setRAppRegBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="magic_link">
                <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700 px-3 py-2 mb-3 text-[11px] text-emerald-900 dark:text-emerald-200">
                  Wird <strong>direkt nach Terminbuchung</strong> (Calendly-Webhook) an den Bewerber gesendet – enthält den Magic-Link zum KI-Bewerbungsgespräch. Der Link steht in <code>{"{{portal_link}}"}</code>. Weitere Platzhalter: <code>{"{{first_name}}"}</code>, <code>{"{{recruiter_name}}"}</code>, <code>{"{{tenant_name}}"}</code>.
                </div>
                <TemplateEditor
                  label="Interview-Einladung (Magic-Link)"
                  subject={mlSubject} onSubjectChange={setMlSubject}
                  body={mlBody} onBodyChange={setMlBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
                <div className="mt-4">
                  <Label className="text-xs font-medium">Button-Beschriftung</Label>
                  <Input value={mlButton} onChange={(e) => setMlButton(e.target.value)} placeholder="Bewerbungsgespräch starten" className="mt-1 max-w-sm" />
                </div>
              </TabsContent>
              <TabsContent value="booking_confirmation">
                <div className="rounded-md border border-teal-300 bg-teal-50 dark:bg-teal-950/30 dark:border-teal-700 px-3 py-2 mb-3 text-[11px] text-teal-900 dark:text-teal-200">
                  Wird <strong>direkt nach jeder Terminbuchung</strong> (eigenes Buchungssystem <em>und</em> Calendly-gebuchte Vermittlungs-Termine) an den Bewerber gesendet – mit Kalendereintrag (.ics) im Anhang. Cron alle 2 Min, einmal pro Bewerbung. Platzhalter: <code>{"{{first_name}}"}</code>, <code>{"{{appointment_date}}"}</code>, <code>{"{{appointment_time}}"}</code>, <code>{"{{duration_minutes}}"}</code>, <code>{"{{cancel_url}}"}</code>, <code>{"{{recruiter_name}}"}</code>, <code>{"{{tenant_name}}"}</code>.
                </div>
                <TemplateEditor
                  label="Terminbestätigung (mit .ics-Kalendereintrag)"
                  subject={bcSubject} onSubjectChange={setBcSubject}
                  body={bcBody} onBodyChange={setBcBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
                <div className="mt-4">
                  <Label className="text-xs font-medium">Button-Beschriftung</Label>
                  <Input value={bcButton} onChange={(e) => setBcButton(e.target.value)} placeholder="Termin verwalten" className="mt-1 max-w-sm" />
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>



        </Tabs>
      )}

      {/* Test Send */}
      {selectedTenant && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Send className="h-4 w-4" /> Test-E-Mail senden
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">Empfänger-E-Mail</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@example.com"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleUseMyEmail}>
                    An mich
                  </Button>
                </div>
              </div>
              <div className="w-60">
                <Label className="text-xs">Template</Label>
                <Select value={testType} onValueChange={(v) => setTestType(v as TestTemplateKey)}>
                  <SelectTrigger className="mt-1 h-10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_TEST_TEMPLATES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleTestSend}
                disabled={testing || bulkRunning || !testEmail || !smtpConfigured}
                className="gap-1.5"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Senden
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleTestAll}
                disabled={testing || bulkRunning || !testEmail || !smtpConfigured}
                className="gap-1.5"
                title="Sendet nacheinander eine Test-E-Mail pro Template"
              >
                {bulkRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                Alle Templates testen
              </Button>
            </div>
            {!smtpConfigured && (
              <p className="text-xs text-destructive mt-2">
                Testversand nicht möglich – SMTP ist nicht konfiguriert.
              </p>
            )}
            {bulkResults.length > 0 && (
              <div className="mt-4 border rounded-md divide-y">
                {bulkResults.map((r) => (
                  <div key={r.key} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                      <span className="font-medium">{r.label}</span>
                      <span className="text-muted-foreground">({r.key})</span>
                    </div>
                    <div className={r.ok ? "text-green-700" : "text-destructive truncate max-w-[50%]"}>
                      {r.ok ? "gesendet" : (r.error || "Fehler")}
                    </div>
                  </div>
                ))}
                {bulkRunning && (
                  <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> weiter…
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type DryRunStep = { key: string; label: string; ok?: boolean; detail?: string; reason?: string };
type DryRunResult = { ok: boolean; summary: string; steps: DryRunStep[] };
type DryRunLanding = { id: string; slug: string | null; source_slug: string | null; tenant_id: string | null; domain: string | null; booking_mode: string | null; intermediate_company_name: string | null };

function DryRunPanel() {
  const { toast } = useToast();
  const listFn = useServerFn(listLandingPagesForDryRun);
  const listFlowsFn = useServerFn(listAllFlows);
  const runSingleFn = useServerFn(dryRunApplicationReceived);
  const runFlowsFn = useServerFn(dryRunFlows);

  const [landings, setLandings] = useState<DryRunLanding[]>([]);
  const [flows, setFlows] = useState<Array<{ key: string; group: string; label: string }>>([]);
  const [selected, setSelected] = useState<string>("");
  const [email, setEmail] = useState("");
  const [selectedFlows, setSelectedFlows] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    listFn({ data: {} as any })
      .then((r: any) => setLandings((r?.rows ?? []) as DryRunLanding[]))
      .catch((e) => toast({ title: "Landings laden fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" }));
    listFlowsFn({ data: {} as any })
      .then((r: any) => {
        const list = (r?.flows ?? []) as Array<{ key: string; group: string; label: string }>;
        setFlows(list);
        setSelectedFlows(new Set(list.map((f) => f.key)));
      })
      .catch((e) => toast({ title: "Flows laden fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" }));
  }, []);

  const toggleFlow = (key: string) => {
    setSelectedFlows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectAll = () => setSelectedFlows(new Set(flows.map((f) => f.key)));
  const selectNone = () => setSelectedFlows(new Set());

  const runAll = async () => {
    if (!selected || !email || selectedFlows.size === 0) {
      toast({ title: "Landing, Test-Adresse und min. 1 Flow wählen", variant: "destructive" });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await runFlowsFn({ data: { landing_page_id: selected, test_email: email, flow_keys: Array.from(selectedFlows) } as any });
      setResult(res);
      toast({
        title: (res as any).ok ? "✅ Alle Flows grün" : "❌ Fehler in mind. einem Flow",
        description: (res as any).summary,
        variant: (res as any).ok ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Dry-Run Fehler", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const runDeep = async () => {
    if (!selected || !email) {
      toast({ title: "Landing + Test-Adresse wählen", variant: "destructive" });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await runSingleFn({ data: { landing_page_id: selected, test_email: email, send_email: true } as any });
      setResult(res);
      toast({
        title: (res as any).ok ? "✅ Bewerbungsflow grün" : "❌ Bewerbungsflow fehlgeschlagen",
        description: (res as any).summary,
        variant: (res as any).ok ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Dry-Run Fehler", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const groupLabel = (g: string) => g === "applicant" ? "Bewerber" : g === "employee" ? "Mitarbeiter" : "System";
  const grouped = ["applicant", "employee", "system"].map((g) => ({
    group: g,
    flows: flows.filter((f) => f.group === g),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> End-to-End Test: Alle Mail-Flows
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Sendet echte Testmails (mit <code>[DRY-RUN]</code>-Präfix) für jeden ausgewählten Flow
          über die produktive Edge-Function. Prüft vorher Tenant, SMTP, Pause-Flag und Suppression.
          <strong> Keine</strong> DB-Änderungen, <strong>keine</strong> Fehler in <code>email_send_log</code>.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Landing Page</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger><SelectValue placeholder="Landing wählen…" /></SelectTrigger>
              <SelectContent className="max-h-80">
                {landings.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {(l.slug ?? l.source_slug ?? l.id.slice(0, 8))} · {l.booking_mode ?? "calendly"} {l.domain ? `· ${l.domain}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Test-E-Mail (Empfänger)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dein.name@example.com" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Flows ({selectedFlows.size}/{flows.length} ausgewählt)</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={selectAll} className="h-7 text-xs">Alle</Button>
              <Button type="button" size="sm" variant="ghost" onClick={selectNone} className="h-7 text-xs">Keine</Button>
            </div>
          </div>
          <div className="border rounded-md divide-y">
            {grouped.map(({ group, flows: gFlows }) => gFlows.length > 0 && (
              <div key={group} className="px-3 py-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">{groupLabel(group)}</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {gFlows.map((f) => (
                    <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedFlows.has(f.key)}
                        onChange={() => toggleFlow(f.key)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={runAll} disabled={running || !selected || !email || selectedFlows.size === 0}>
            {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Läuft…</> : <><Send className="mr-2 h-4 w-4" /> Ausgewählte Flows testen ({selectedFlows.size})</>}
          </Button>
          <Button onClick={runDeep} disabled={running || !selected || !email} variant="outline">
            <Activity className="mr-2 h-4 w-4" /> Tiefen-Test „Bewerbungseingang" (mit Trigger-Pfad)
          </Button>
        </div>

        {result && (
          <div className="border rounded-md">
            <div className={`px-3 py-2 text-sm font-medium border-b ${result.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
              {result.summary}
            </div>
            <ul className="divide-y">
              {(result.steps ?? []).map((s: any, i: number) => (
                <li key={s.key ?? i} className="px-3 py-2 flex gap-3 items-start">
                  <span className="mt-0.5">
                    {s.ok
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      : <AlertTriangle className="h-4 w-4 text-red-600" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {s.label}
                      {typeof s.ms === "number" && <span className="ml-2 text-xs text-muted-foreground">· {s.ms}ms</span>}
                    </div>
                    {s.detail && <div className="text-xs text-muted-foreground break-all">{s.detail}</div>}
                    {s.reason && !s.ok && <div className="text-xs text-red-700 mt-0.5">reason: <code>{s.reason}</code></div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

