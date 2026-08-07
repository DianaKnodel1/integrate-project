import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mail, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, Search, FileText, ScrollText, Pencil, RotateCcw, Eye,
} from "lucide-react";
import { EMAIL_TYPE_LABELS, HIDDEN_EMAIL_STATUS, type EmailLog } from "@/lib/email-stats";
import { resendEmailLog, isTokenTemplate } from "@/lib/email-resend";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmailRetryQueuePanel } from "@/components/admin/EmailRetryQueuePanel";



export const Route = createFileRoute("/admin/email-center")({
  component: AdminEmailCenterPage,
});

/**
 * E-Mail-Center v2 — Reset & minimal.
 * Zeigt ausschließlich das, was der aktuelle Flow tatsächlich versendet.
 * Alles wird live aus email_send_log berechnet. Nur technisch ersetzte
 * Retry-Zeilen (superseded) werden ausgeblendet; echte Sendungen bleiben einzeln sichtbar.
 */

// Aktive Templates im neuen Flow (Bewerbung -> Interview -> Onboarding).
const ACTIVE_TEMPLATES: { key: string; keys?: string[]; label: string; group: string; trigger: string }[] = [
  // Vermittlungs-Flow (Broker) — Bewerber-Reminder aus send-application-reminders
  { key: "vermittlung_no_booking_24h", label: "Vermittlung: Kein Termin (24h)",  group: "Vermittlung", trigger: "24h nach Bewerbung ohne Calendly-Buchung" },
  { key: "vermittlung_no_booking_72h", label: "Vermittlung: Kein Termin (72h)",  group: "Vermittlung", trigger: "72h nach Bewerbung ohne Calendly-Buchung" },
  { key: "vermittlung_no_show_24h",    label: "No-Show Interview",               group: "Vermittlung", trigger: "24h nach verpasstem Termin" },
  { key: "interview_invite_30min",     keys: ["interview_invite_30min", "bewerbung_magic_link"], label: "Vermittlung: Interview-Einladung", group: "Vermittlung", trigger: "30 Minuten vor dem Termin" },
  { key: "booking_confirmation",       label: "Vermittlung: Terminbestätigung",   group: "Vermittlung", trigger: "Direkt nach Terminbuchung" },
  { key: "application_received",       label: "Vermittlung: Bewerbung eingegangen", group: "Vermittlung", trigger: "Sofort nach Bewerbungseingang (Broker-Flow)" },
  { key: "vermittlung_registration_pending", keys: ["vermittlung_registration_pending_24h", "vermittlung_registration_pending_72h", "fasttrack_registration_pending_24h", "fasttrack_registration_pending_72h"], label: "Registrierung offen", group: "Vermittlung", trigger: "24h / 72h nach Zusage ohne Registrierung" },
  { key: "rebook_after_cancel",        keys: ["vermittlung_rebook_after_cancel_24h", "vermittlung_rebook_after_cancel_72h", "fasttrack_rebook_after_cancel_24h", "fasttrack_rebook_after_cancel_72h"], label: "Neuer Termin nach Absage", group: "Vermittlung", trigger: "24h / 72h nach Cancel des Termins" },
  // Fast-Track / Onboarding
  { key: "invitation",                       label: "Herzlichen Glückwunsch", group: "Onboarding", trigger: "Sofort nach Fast-Track-Zusage" },
  { key: "reminder_invite",                  label: "Registrierung abschließen",    group: "Reminder",   trigger: "Akzeptierte Bewerber ohne Account" },
  { key: "reminder_complete_registration",   label: "Onboarding (Perso/Vertrag)",   group: "Reminder",   trigger: "Nach Registrierung ohne KYC/Vertrag" },
  { key: "email_confirmation", keys: ["signup_confirmation", "signup_confirmation_resend", "reminder_confirm_email"], label: "E-Mail bestätigen", group: "Reminder", trigger: "Registrierung, erneutes Senden + Reminder bei unbestätigter Mail" },
  { key: "reminder_no_recent_booking",       label: "Keine Buchung (7 Tage)",       group: "Reminder",   trigger: "1 Reminder nach 7 Tagen ohne Auftragsbuchung" },
  { key: "reminder_domain_recovery", keys: ["reminder_domain_recovery", "domain_recovery"], label: "Domain-Recovery", group: "Reminder", trigger: "Nach Wiederherstellung eines pausierten Tenant-Versands" },
  { key: "chat_reminder",                    label: "Chat-Reminder (manuell)",      group: "Support",    trigger: "Wird vom Admin manuell ausgelöst" },
  { key: "password_reset",                   label: "Passwort zurücksetzen",        group: "Auth",       trigger: "User löst Reset aus" },
];

type Row = EmailLog & { tenant_id?: string | null };

function AdminEmailCenterPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [q, setQ] = useState("");
  /** Filter auf einen Tenant (Absender-Mandant) — "" = alle. */
  const [tenantFilter, setTenantFilter] = useState("");
  const [confirmResend, setConfirmResend] = useState<Row | null>(null);
  /** Zeile, deren gerendertes HTML gerade angesehen wird. */
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  /** Exakte Gesamtzahl aus der DB — unabhängig vom 5.000-Zeilen-Fenster der Liste. */
  const [exactTotal, setExactTotal] = useState<number | null>(null);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(100);
  const [resending, setResending] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - (range === "24h" ? 1 : range === "7d" ? 7 : 30) * 86400_000).toISOString();
    // Technische Zeilen ausblenden (zentral in email-stats definiert):
    // "superseded" = abgelöster Retry, "duplicate" = bereinigter Doppelversand.
    const HIDDEN_STATUS = HIDDEN_EMAIL_STATUS;
    const [{ data }, { count }, { data: tenants }] = await Promise.all([
      supabase
        .from("email_send_log")
        .select("id,message_id,tenant_id,template_name,recipient_email,status,error_message,metadata,created_at,acknowledged_at,rendered_subject,rendered_html")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .not("status", "in", `(${HIDDEN_STATUS.join(",")})`),
      supabase.from("tenants").select("id,name,emails_paused,emails_paused_by,emails_paused_reason,smtp_host,smtp_username,smtp_password,sender_email"),
    ]);
    setRows(((data as Row[] | null) ?? []).filter(r => !HIDDEN_STATUS.includes(r.status)));
    setExactTotal(count ?? null);
    setTenantNames(Object.fromEntries(((tenants as { id: string; name: string }[] | null) ?? []).map(t => [t.id, t.name])));

    // SMTP-/Pausen-Probleme werden ausschließlich auf dem Dashboard angezeigt.
    setVisible(100);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

  /**
   * Doppelversand-Wächter: gleiche Vorlage + gleicher Empfänger + GLEICHER
   * Vorgang (application_id) mehrfach innerhalb von 24 h erfolgreich versendet.
   * Der Vorgang muss mit rein: dieselbe Person kann sich zweimal bewerben —
   * dann sind zwei Mails derselben Vorlage korrekt und kein Fehler.
   */
  const duplicates = useMemo(() => {
    const since = Date.now() - 24 * 3600_000;
    type Grp = {
      template: string; recipient: string; count: number; last: string;
      vorgaenge: Set<string>; manual: number; sources: Set<string>;
    };
    const groups = new Map<string, Grp>();
    for (const r of rows) {
      if (r.status !== "sent") continue;
      if (new Date(r.created_at).getTime() < since) continue;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const vorgang = String(meta.application_id ?? meta.appointment_id ?? "");
      const manual = meta.trigger === "manual" || meta.manual_send === true;
      const key = `${r.template_name ?? "?"}|${(r.recipient_email ?? "").toLowerCase()}`;
      const g = groups.get(key) ?? {
        template: r.template_name ?? "?", recipient: r.recipient_email ?? "",
        count: 0, last: r.created_at, vorgaenge: new Set<string>(), manual: 0, sources: new Set<string>(),
      };
      g.count++;
      if (r.created_at > g.last) g.last = r.created_at;
      if (vorgang) g.vorgaenge.add(vorgang);
      if (manual) g.manual++;
      if (meta.source) g.sources.add(String(meta.source));
      groups.set(key, g);
    }
    return [...groups.values()]
      .filter(g => g.count > 1)
      .map(g => {
        // Verschiedene Vorgänge derselben Person = korrektes Verhalten.
        const kind: "expected" | "manual" | "real" =
          g.vorgaenge.size >= g.count ? "expected" : g.manual > 0 ? "manual" : "real";
        return { ...g, kind, vorgangCount: g.vorgaenge.size, source: [...g.sources].join(", ") };
      })
      .sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === "real" ? -1 : b.kind === "real" ? 1 : a.kind === "manual" ? -1 : 1));
  }, [rows]);

  /** Echte Doppelungen — nur die sind ein Fehler im System. */
  const realDuplicates = useMemo(() => duplicates.filter(d => d.kind === "real"), [duplicates]);

  /**
   * "Warum kam keine Mail an?" — Fehlversuche nach Ursache in Klartext,
   * damit erkennbar ist, was zu tun ist (Passwort, Zugangsdaten, Limit …).
   */
  const failureCauses = useMemo(() => {
    const classify = (msg: string): { label: string; action: string } => {
      const m = msg.toLowerCase();
      if (m.includes("535") || m.includes("authentication failed"))
        return { label: "SMTP-Passwort wird abgelehnt", action: "Zugangsdaten des Mandanten neu hinterlegen und testen" };
      if (m.includes("smtp_incomplete") || m.includes("no credentials"))
        return { label: "Keine SMTP-Zugangsdaten hinterlegt", action: "Mandanten-Einstellungen vervollständigen" };
      if (m.includes("554") || m.includes("too many messages") || m.includes("rate"))
        return { label: "Limit des Mailanbieters erreicht", action: "Kein Eingriff nötig – wird automatisch nachgeholt" };
      if (m.includes("550") || m.includes("does not exist") || m.includes("unknown user") || m.includes("mailbox"))
        return { label: "Adresse existiert nicht", action: "Adresse beim Bewerber prüfen (Tippfehler)" };
      if (m.includes("timeout") || m.includes("etimedout") || m.includes("econn"))
        return { label: "Mailserver nicht erreichbar", action: "Host/Port prüfen, danach erneut senden" };
      if (m.includes("paused")) return { label: "Versand für Mandant pausiert", action: "Pause im Mandanten aufheben" };
      return { label: msg ? msg.slice(0, 60) : "Ohne Fehlermeldung", action: "Details im Roh-Log ansehen" };
    };
    const m = new Map<string, { label: string; action: string; count: number; tenants: Set<string>; last: string }>();
    for (const r of rows) {
      if (!["failed", "dlq", "bounced"].includes(r.status)) continue;
      const c = classify(String(r.error_message ?? ""));
      const cur = m.get(c.label) ?? { ...c, count: 0, tenants: new Set<string>(), last: r.created_at };
      cur.count++;
      if (r.created_at > cur.last) cur.last = r.created_at;
      cur.tenants.add(tenantNames[r.tenant_id ?? ""] ?? "Ohne Mandant");
      m.set(c.label, cur);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [rows, tenantNames]);

  /** Tagesverlauf: echte Sendungen pro Tag (für die Balken). */
  const daily = useMemo(() => {
    const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
    const buckets: { day: string; sent: number; failed: number; skipped: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      buckets.push({ day: d.toISOString().slice(0, 10), sent: 0, failed: 0, skipped: 0 });
    }
    const idx = new Map(buckets.map((b, i) => [b.day, i]));
    for (const r of rows) {
      const i = idx.get(r.created_at.slice(0, 10));
      if (i === undefined) continue;
      if (r.status === "sent") buckets[i].sent++;
      else if (["failed", "dlq", "bounced"].includes(r.status)) buckets[i].failed++;
      else if (r.status === "skipped") buckets[i].skipped++;
    }
    return buckets;
  }, [rows, range]);

  /** Volumen pro Tenant — zeigt, wer wie viel vom Kontingent verbraucht. */
  const perTenant = useMemo(() => {
    const m = new Map<string, { sent: number; failed: number; skipped: number }>();
    for (const r of rows) {
      const key = r.tenant_id ?? "—";
      const cur = m.get(key) ?? { sent: 0, failed: 0, skipped: 0 };
      if (r.status === "sent") cur.sent++;
      else if (["failed", "dlq", "bounced"].includes(r.status)) cur.failed++;
      else if (r.status === "skipped") cur.skipped++;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, name: tenantNames[id] ?? (id === "—" ? "Ohne Mandant" : id.slice(0, 8)), ...v }))
      .sort((a, b) => b.sent - a.sent);
  }, [rows, tenantNames]);

  /** Vorschau-HTML immer als UTF-8 rendern (sonst "Ã¤" statt "ä"). */
  const withUtf8Charset = (html: string) => {
    if (/<meta[^>]+charset/i.test(html)) return html;
    const meta = '<meta charset="utf-8">';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`);
    return `${meta}${html}`;
  };

  /** CSV-Export des aktuellen Zeitraums (alle geladenen Zeilen). */
  const exportCsv = () => {
    const head = ["Zeitpunkt", "Mandant", "Template", "Empfaenger", "Status", "Fehler"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map(r => [
      new Date(r.created_at).toLocaleString("de-DE"),
      tenantNames[r.tenant_id ?? ""] ?? "",
      r.template_name,
      r.recipient_email,
      r.status,
      r.error_message ?? "",
    ].map(esc).join(";"));
    const blob = new Blob(["\uFEFF" + [head.map(esc).join(";"), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `email-log-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doResend = async (row: Row) => {
    setResending(true);
    const r = await resendEmailLog(row.id);
    setResending(false);
    setConfirmResend(null);
    if (r.ok) {
      toast({ title: "E-Mail erneut gesendet", description: r.to ? `An ${r.to}` : undefined });
      load();
    } else if (r.code === "token_template") {
      toast({ title: "Link abgelaufen", description: "Diese E-Mail enthält einen zeitlich begrenzten Link — bitte über den Bewerber-Datensatz neu erzeugen.", variant: "destructive" });
    } else {
      toast({ title: "Versand fehlgeschlagen", description: r.message, variant: "destructive" });
    }
  };

  const stats = useMemo(() => {
    const s = { total: rows.length, sent: 0, failed: 0, pending: 0, skipped: 0 };
    for (const r of rows) {
      if (r.status === "sent") s.sent++;
      else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced") s.failed++;
      else if (r.status === "pending") s.pending++;
      else if (r.status === "skipped") s.skipped++;
    }
    return s;
  }, [rows]);

  const perTemplate = useMemo(() => {
    const m = new Map<string, { sent: number; failed: number; pending: number; skipped: number; last?: string }>();
    for (const r of rows) {
      const cur = m.get(r.template_name) ?? { sent: 0, failed: 0, pending: 0, skipped: 0 };
      if (r.status === "sent") cur.sent++;
      else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced") cur.failed++;
      else if (r.status === "pending" || r.status === "claimed") cur.pending++;
      else if (r.status === "skipped") cur.skipped++;
      if (!cur.last || r.created_at > cur.last) cur.last = r.created_at;
      m.set(r.template_name, cur);
    }
    return m;
  }, [rows]);

  /**
   * Hängende & fehlgeschlagene Mails: alles, was Aufmerksamkeit braucht.
   * "Hängend" = seit mehr als 15 Minuten im Status pending/claimed,
   * also vom Versand beansprucht, aber nie als gesendet bestätigt.
   */
  const problems = useMemo(() => {
    const cutoff = Date.now() - 15 * 60_000;
    return rows
      .filter(r => {
        if (["failed", "dlq", "bounced"].includes(r.status)) return true;
        if (["pending", "claimed"].includes(r.status)) return new Date(r.created_at).getTime() < cutoff;
        return false;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [rows]);



  // Wie viele der aktiven Kettenschritte hatten im Zeitraum mind. einen Versand?
  const coverage = useMemo(() => {
    const active = ACTIVE_TEMPLATES.filter(t =>
      (t.keys ?? [t.key]).some(k => {
        const i = perTemplate.get(k);
        return i ? i.sent + i.failed + i.pending + i.skipped > 0 : false;
      })
    ).length;
    return { active, total: ACTIVE_TEMPLATES.length };
  }, [perTemplate]);



  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tenantFilter && (r.tenant_id ?? "") !== tenantFilter) return false;
      if (!ql) return true;
      return (
        r.recipient_email?.toLowerCase().includes(ql) ||
        r.template_name?.toLowerCase().includes(ql) ||
        (EMAIL_TYPE_LABELS[r.template_name] ?? "").toLowerCase().includes(ql) ||
        (tenantNames[r.tenant_id ?? ""] ?? "").toLowerCase().includes(ql)
      );
    });
  }, [rows, q, tenantFilter, tenantNames]);
  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">E-Mail-Center</h1>
            <p className="text-sm text-muted-foreground">Aktive Templates im neuen Flow — live aus email_send_log.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["24h", "7d", "30d"] as const).map(k => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)} className="h-8 text-xs">
              {k === "24h" ? "24 h" : k === "7d" ? "7 Tage" : "30 Tage"}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={exportCsv} className="h-8 text-xs">CSV</Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Cross-Nav */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground mr-1">Weiter zu:</span>
        <Link to="/admin/email-templates">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <Pencil className="h-3 w-3" /> Templates bearbeiten
          </Button>
        </Link>
        <Link to="/admin/email-logs">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <ScrollText className="h-3 w-3" /> Roh-Log ansehen
          </Button>
        </Link>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Gesamt" value={exactTotal ?? stats.total} icon={Mail} tone="muted" />
        <Kpi label="Versendet" value={stats.sent} icon={CheckCircle2} tone="emerald" />
        <Kpi label="Ausstehend" value={stats.pending} icon={Clock} tone="amber" />
        <Kpi label="Übersprungen" value={stats.skipped} icon={Clock} tone="muted" />
        <Kpi label="Fehlgeschlagen" value={stats.failed} icon={XCircle} tone="rose" />
      </div>


      {/* Versand-Blocker: nur schmaler Hinweis — Details stehen auf dem Dashboard */}

      {/* Automatischer Nachversand */}
      <EmailRetryQueuePanel />

      {/* Doppelversand-Warnung */}
      {duplicates.length > 0 && (
        <Card className={realDuplicates.length > 0 ? "border-rose-500/50 bg-rose-500/5" : "border-amber-500/50 bg-amber-500/5"}>
          <CardContent className="p-4">
            <div className={`text-sm font-semibold ${realDuplicates.length > 0 ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>
              Mehrfachversand in den letzten 24 Stunden ({duplicates.length}) ·{" "}
              {realDuplicates.length > 0 ? `${realDuplicates.length} echte Doppelung` : "keine echte Doppelung"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              „Verschiedene Vorgänge“ ist normal: dieselbe Person hat zwei Bewerbungen oder Termine.
              Nur „Echte Doppelung“ ist ein Fehler. Vollständige Analyse mit{" "}
              <code>scripts/diagnose-duplicates.sh</code>.
            </div>
            <div className="mt-3 space-y-1">
              {duplicates.slice(0, 8).map(d => {
                const badge = d.kind === "real"
                  ? { text: "Echte Doppelung", cls: "text-rose-700 dark:text-rose-400" }
                  : d.kind === "manual"
                    ? { text: "Handversand", cls: "text-amber-700 dark:text-amber-400" }
                    : { text: `${d.vorgangCount} verschiedene Vorgänge`, cls: "text-muted-foreground" };
                return (
                  <div key={`${d.template}|${d.recipient}`} className="flex items-center gap-3 text-xs">
                    <span className="flex-1 truncate">{d.recipient}</span>
                    <span className="truncate text-muted-foreground max-w-[14rem]">
                      {EMAIL_TYPE_LABELS[d.template] ?? d.template}
                    </span>
                    <span className={`truncate max-w-[12rem] ${badge.cls}`}>{badge.text}</span>
                    <span className="tabular-nums font-semibold">×{d.count}</span>
                  </div>
                );
              })}
              {duplicates.length > 8 && (
                <div className="text-[11px] text-muted-foreground">… und {duplicates.length - 8} weitere</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warum Mails nicht ankamen */}
      {failureCauses.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-rose-700 dark:text-rose-400">
              Warum Mails nicht ankamen ({failureCauses.reduce((n, f) => n + f.count, 0)})
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Fehlversuche im gewählten Zeitraum, nach Ursache gruppiert — mit dem nötigen nächsten Schritt.
            </div>
            <div className="mt-3 space-y-2">
              {failureCauses.slice(0, 8).map(f => (
                <div key={f.label} className="text-xs">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 truncate font-medium">{f.label}</span>
                    <span className="truncate text-muted-foreground max-w-[16rem]">{[...f.tenants].join(", ")}</span>
                    <span className="tabular-nums font-semibold text-rose-700 dark:text-rose-400">{f.count}×</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">➜ {f.action}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tagesverlauf */}
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-semibold">Versand-Volumen pro Tag</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Grenzen: 150 Mails/Stunde und 2.400 Mails/Tag je Mandant.
          </div>
          <div className="mt-4 flex items-end gap-1 h-28">
            {daily.map(d => {
              const max = Math.max(1, ...daily.map(x => x.sent + x.failed + x.skipped));
              const h = (n: number) => `${Math.round((n / max) * 100)}%`;
              return (
                <div key={d.day} className="flex-1 flex flex-col justify-end gap-0.5 group relative" title={`${d.day}: ${d.sent} gesendet, ${d.failed} Fehler, ${d.skipped} übersprungen`}>
                  {d.skipped > 0 && <div className="w-full bg-muted rounded-sm" style={{ height: h(d.skipped) }} />}
                  {d.failed > 0 && <div className="w-full bg-rose-500/70 rounded-sm" style={{ height: h(d.failed) }} />}
                  <div className="w-full bg-primary/80 rounded-sm" style={{ height: h(d.sent) }} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/80" /> Gesendet</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500/70" /> Fehler</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted" /> Übersprungen</span>
          </div>
        </CardContent>
      </Card>

      {/* Mandanten-Aufschlüsselung */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b text-sm font-semibold">Volumen pro Mandant</div>
          <div className="divide-y">
            {perTenant.slice(0, 10).map(t => (
              <div key={t.id} className="px-4 py-2 flex items-center gap-4 text-xs">
                <span className="flex-1 truncate font-medium">{t.name}</span>
                <span className="text-emerald-600 tabular-nums">✓ {t.sent}</span>
                <span className="text-rose-600 tabular-nums">✗ {t.failed}</span>
                <span className="text-muted-foreground tabular-nums">⤼ {t.skipped}</span>
              </div>
            ))}
            {perTenant.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">Kein Versand im Zeitraum.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Aktive Templates */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Aktive Mail-Templates</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Klick auf ein Template öffnet den Editor.</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium">
                {coverage.active} von {coverage.total} Schritten aktiv
              </div>
              <div className="text-[11px] text-muted-foreground">Zeitraum: {range === "24h" ? "24 h" : range === "7d" ? "7 Tage" : "30 Tage"}</div>
            </div>
          </div>

          <div className="divide-y">
            {ACTIVE_TEMPLATES.map(t => {
              const keys = t.keys ?? [t.key];
              const s = keys.reduce((acc, key) => {
                const item = perTemplate.get(key);
                if (!item) return acc;
                acc.sent += item.sent;
                acc.failed += item.failed;
                acc.pending += item.pending;
                acc.skipped += item.skipped;
                if (item.last && (!acc.last || item.last > acc.last)) acc.last = item.last;
                return acc;
              }, { sent: 0, failed: 0, pending: 0, skipped: 0, last: undefined as string | undefined });
              const total = s.sent + s.failed + s.pending + s.skipped;
              const lastRel = s.last ? relativeTime(s.last) : null;

              return (
                <Link
                  key={t.key}
                  to="/admin/email-templates"
                  className="px-4 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{t.label}</span>
                      <Badge variant="secondary" className="text-[10px]">{t.group}</Badge>
                      {total === 0 && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">
                          Kein Versand im Zeitraum
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.trigger}
                      {lastRel && <span className="ml-1.5">· Zuletzt {lastRel}</span>}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs tabular-nums">
                    <span className="text-emerald-600">✓ {s.sent}</span>
                    <span className="text-amber-600">⏳ {s.pending}</span>
                    <span className="text-rose-600">✗ {s.failed}</span>
                  </div>
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>


      {/* Hängende & fehlgeschlagene Mails */}
      {problems.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <div className="text-sm font-semibold">Hängende &amp; fehlgeschlagene E-Mails</div>
              <Badge variant="destructive" className="text-[10px]">{problems.length}</Badge>
              <span className="text-[11px] text-muted-foreground ml-auto">
                „Hängend“ = seit über 15 Minuten nicht bestätigt
              </span>
            </div>
            <div className="divide-y max-h-96 overflow-auto">
              {problems.slice(0, 50).map((r, i) => (
                <div key={i} className="px-4 py-2 text-xs flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {EMAIL_TYPE_LABELS[r.template_name] ?? r.template_name} → {r.recipient_email}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      Absender-Mandant: {tenantNames[r.tenant_id ?? ""] ?? "— kein Tenant —"} · {relativeTime(r.created_at)}
                    </div>
                    {r.error_message && <div className="text-rose-600 truncate">{r.error_message}</div>}
                  </div>
                  <StatusBadge status={r.status} />
                  {r.rendered_html && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="E-Mail ansehen" onClick={() => setPreviewRow(r)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                  {canResendRow(r) && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Erneut senden" onClick={() => setConfirmResend(r)}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Log-Explorer */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <div className="text-sm font-semibold flex-1">Verlauf</div>
            <select
              value={tenantFilter}
              onChange={e => setTenantFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Alle Mandanten</option>
              {Object.entries(tenantNames).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <div className="relative w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="E-Mail, Vorlage oder Mandant…" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Vorlage</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Empfänger</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Mandant</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Wann</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-4 py-1.5" title={r.template_name}>{EMAIL_TYPE_LABELS[r.template_name] ?? r.template_name}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{r.recipient_email}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{tenantNames[r.tenant_id ?? ""] ?? "—"}</td>
                    <td className="px-4 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-1.5 text-[10px] text-muted-foreground tabular-nums">{new Date(r.created_at).toLocaleString("de-DE")}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.rendered_html && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="E-Mail ansehen" onClick={() => setPreviewRow(r)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                      )}
                      {canResendRow(r) && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Erneut senden" onClick={() => setConfirmResend(r)}>
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nichts zu sehen.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > shown.length && (
            <div className="px-4 py-3 border-t flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{shown.length} von {filtered.length} Einträgen</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVisible(v => v + 200)}>
                Mehr anzeigen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bestätigung: generischer Resend */}
      <Dialog open={!!previewRow} onOpenChange={(open) => !open && setPreviewRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {previewRow?.rendered_subject
                || EMAIL_TYPE_LABELS[previewRow?.template_name ?? ""]
                || previewRow?.template_name}
            </DialogTitle>
            <DialogDescription>
              An {previewRow?.recipient_email} ·{" "}
              {previewRow && new Date(previewRow.created_at).toLocaleString("de-DE")}
            </DialogDescription>
          </DialogHeader>
          {previewRow?.rendered_html ? (
            <iframe
              srcDoc={withUtf8Charset(previewRow.rendered_html)}
              sandbox=""
              title="E-Mail-Vorschau"
              className="w-full h-[60vh] border rounded-lg bg-white"
            />
          ) : (
            <div className="text-sm text-muted-foreground">Für diese Mail wurde kein HTML gespeichert.</div>
          )}
          <DialogFooter className="gap-2">
            {previewRow && canResendRow(previewRow) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setConfirmResend(previewRow); setPreviewRow(null); }}>
                <RotateCcw className="h-3.5 w-3.5" /> Erneut senden
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPreviewRow(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmResend} onOpenChange={(open) => !open && setConfirmResend(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>E-Mail erneut senden?</DialogTitle>
            <DialogDescription>
              {confirmResend && (
                <>
                  „{EMAIL_TYPE_LABELS[confirmResend.template_name] ?? confirmResend.template_name}“ geht erneut an{" "}
                  <strong>{confirmResend.recipient_email}</strong> — mit exakt dem gespeicherten Inhalt vom{" "}
                  {new Date(confirmResend.created_at).toLocaleString("de-DE")}.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmResend(null)}>Abbrechen</Button>
            <Button size="sm" className="gap-1.5" disabled={resending} onClick={() => confirmResend && doResend(confirmResend)}>
              <RotateCcw className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`} /> Jetzt senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function canResendRow(r: Row): boolean {
  return !!r.rendered_html && !isTokenTemplate(r.template_name);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}


function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "muted" | "emerald" | "amber" | "rose" }) {
  const c = {
    muted:   "bg-muted/40 text-foreground",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber:   "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    rose:    "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg grid place-items-center ${c}`}><Icon className="h-4 w-4" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-heading font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:       "bg-emerald-100 text-emerald-700",
    pending:    "bg-amber-100 text-amber-800",
    claimed:    "bg-amber-100 text-amber-800",
    dlq:        "bg-rose-100 text-rose-700",
    failed:     "bg-rose-100 text-rose-700",
    bounced:    "bg-rose-100 text-rose-700",
    suppressed: "bg-slate-200 text-slate-700",
    skipped:    "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    sent: "Gesendet",
    pending: "Hängend",
    claimed: "Hängend",
    dlq: "Endgültig fehlgeschlagen",
    failed: "Fehlgeschlagen",
    bounced: "Gebounced",
    suppressed: "Unterdrückt",
    skipped: "Übersprungen",
  };
  return (
    <span
      title={status}
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  );
}
