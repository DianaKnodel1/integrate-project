import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useNavigate } from "@/lib/router-compat";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAdminData } from "@/contexts/AdminDataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Users, Search, ExternalLink, Trash2, MailWarning } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { StageTimeline, type Stage } from "@/components/StageTimeline";
import { deleteOrphanApplications, deleteApplication, bulkDeleteApplications } from "@/lib/admin-delete.functions";
import { archiveOldApplications } from "@/lib/admin-maintenance.functions";
import { resendRegistrationInvite } from "@/lib/application-stage.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { usePagination } from "@/hooks/use-pagination";
import { fetchAll } from "@/lib/fetch-all";
import { PaginationBar } from "@/components/PaginationBar";
import { MailChain } from "@/components/mail/MailChain";
import { computeNextStep } from "@/lib/mail-next-step";
import { mailLabel, mergeMailEvents, type MailEvent } from "@/lib/mail-chain";

/**
 * Bewerbungen — nur applications (Funnel bis Registrierung).
 * Mitarbeiter (mit user_id + Profile) verschwinden hier und leben in /admin/mitarbeiter.
 */

type Phase =
  | "termin_offen" | "termin_gebucht" | "abgesagt" | "no_show"
  | "interview_laeuft"
  | "auswertung_fehler"
  | "angenommen" | "abgelehnt"
  | "registriert" | "email_bestaetigt" | "onboarding_komplett" | "mitarbeiter_aktiv";

const PHASES: { key: Phase | "alle"; label: string; emoji: string }[] = [
  { key: "alle", label: "Alle", emoji: "👥" },
  { key: "termin_offen", label: "Kein Termin", emoji: "📅" },
  { key: "termin_gebucht", label: "Termin gebucht", emoji: "⏰" },
  { key: "abgesagt", label: "Termin abgesagt", emoji: "🚫" },
  { key: "no_show", label: "Nicht erschienen", emoji: "⚠️" },
  { key: "interview_laeuft", label: "Interview läuft", emoji: "🎙" },
  { key: "auswertung_fehler", label: "Auswertung läuft", emoji: "⏳" },
  { key: "angenommen", label: "Zusage erteilt", emoji: "✅" },
  { key: "abgelehnt", label: "Abgelehnt", emoji: "❌" },
  { key: "registriert", label: "Registriert", emoji: "🧾" },
  { key: "email_bestaetigt", label: "E-Mail bestätigt", emoji: "✉️" },
  { key: "onboarding_komplett", label: "Onboarding fertig", emoji: "📄" },
  { key: "mitarbeiter_aktiv", label: "Mitarbeiter aktiv", emoji: "🚀" },
];

const PHASE_COLOR: Record<Phase, string> = {
  termin_offen: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  termin_gebucht: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  abgesagt: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  no_show: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  interview_laeuft: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  auswertung_fehler: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  angenommen: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  abgelehnt: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  registriert: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  email_bestaetigt: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  onboarding_komplett: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  mitarbeiter_aktiv: "bg-emerald-500 text-white dark:bg-emerald-600 border-0",
};



type ProfileInfo = {
  onboarding: string | null;
  status: string | null;
  emailConfirmed: boolean;
  contractSigned: boolean;
} | null;

function computePhase(a: any, scheduledAt: Date | null, prof: ProfileInfo): Phase {
  const now = Date.now();
  const rec = a.interview_recommendation as string | null;
  // Profile existiert → tiefer im Funnel
  if (prof) {
    if (prof.status === "angenommen") return "mitarbeiter_aktiv";
    if (prof.onboarding === "abgeschlossen" || prof.contractSigned) return "onboarding_komplett";
    if (prof.emailConfirmed) return "email_bestaetigt";
    return "registriert";
  }
  if (a.booking_status === "no_show") return "no_show";
  if (a.booking_status === "cancelled") return "abgesagt";
  if (rec === "invite" || a.status === "akzeptiert") return "angenommen";
  if (rec === "reject" || a.status === "abgelehnt") return "abgelehnt";
  // Interview beendet, aber keine verwertbare KI-Auswertung: technischer Fehler,
  // keine Bewertung. Muss erneut ausgewertet werden.
  if (a.interview_completed_at) return "auswertung_fehler";

  if (a.interview_started_at) return "interview_laeuft";
  if (scheduledAt) {
    if (scheduledAt.getTime() < now - 30 * 60_000 && !a.interview_completed_at) return "no_show";
    return "termin_gebucht";
  }
  return "termin_offen";
}

/** 5-Punkt-Funnel für die Timeline pro Zeile. */
function phaseToStages(phase: Phase): Stage[] {
  // 1 Termin  2 Interview  3 Entscheidung  4 Registriert  5 Onboarding
  const order: Phase[] = [
    "termin_offen","termin_gebucht","abgesagt","no_show",
    "interview_laeuft",
    "auswertung_fehler",
    "angenommen","abgelehnt",
    "registriert","email_bestaetigt",
    "onboarding_komplett","mitarbeiter_aktiv",
  ];

  const idx = order.indexOf(phase);
  const isFailed = phase === "abgelehnt" || phase === "no_show" || phase === "abgesagt";

  // Progress-Level: 0=Termin, 1=Interview, 2=Entscheidung, 3=Registriert, 4=Onboarding
  let lvl = 0;
  if (idx >= order.indexOf("termin_gebucht")) lvl = 1;
  if (idx >= order.indexOf("interview_laeuft")) lvl = 2;
  if (idx >= order.indexOf("auswertung_fehler")) lvl = 2;
  if (idx >= order.indexOf("angenommen")) lvl = 3;
  if (idx >= order.indexOf("registriert")) lvl = 4;
  if (idx >= order.indexOf("onboarding_komplett")) lvl = 5;

  const cur = phase === "termin_offen" ? 0
    : phase === "termin_gebucht" ? 0
    : phase === "abgesagt" ? 0
    : phase === "no_show" ? 1
    : phase === "interview_laeuft" ? 1
    : phase === "auswertung_fehler" || phase === "angenommen" || phase === "abgelehnt" ? 2
    : phase === "registriert" || phase === "email_bestaetigt" ? 3
    : 4;

  const labels = ["Termin", "Interview", "Zusage", "Registriert", "Onboarding"];
  return labels.map((label, i) => {
    let state: Stage["state"] = "todo";
    if (i < lvl) state = "done";
    else if (i === cur) state = isFailed ? "failed" : "current";
    return { key: label, label, state };
  });
}

const searchSchema = z.object({
  tab: z.enum([
    "alle", "eingegangen", "termin", "interview", "no_show", "abgesagt",
    "zusage", "abgelehnt", "onboarded",
  ]).optional().catch("alle"),
});

export const Route = createFileRoute("/admin/bewerbungen")({
  validateSearch: searchSchema,
  component: AdminBewerbungenPage,
});

function AdminBewerbungenPage() {
  const { applications, profiles, allBookings, emailConfirmedUserIds, loadingApplications: loading, loadData } = useAdminData();
  const search = useSearch({ from: "/admin/bewerbungen" });
  const navigate = useNavigate();
  const tab = (search as any).tab ?? "alle";
  const [q, setQ] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const runCleanup = useServerFn(deleteOrphanApplications);
  const runBulkDelete = useServerFn(bulkDeleteApplications);

  const profileByKey = useMemo(() => {
    const byUid = new Map<string, any>();
    const byEmail = new Map<string, any>();
    const byApplicationId = new Map<string, any>();
    for (const p of profiles as any[]) {
      if (p.user_id) byUid.set(p.user_id, p);
      if (p.email) byEmail.set(String(p.email).toLowerCase().trim(), p);
      if (p.application_id) byApplicationId.set(p.application_id, p);
    }
    return { byUid, byEmail, byApplicationId };
  }, [profiles]);

  const bookingByApp = useMemo(() => {
    const m = new Map<string, Date>();
    for (const b of allBookings as any[]) {
      const appId = b.application_id || b.app_id;
      if (!appId) continue;
      const d = b.booking_date && b.booking_time
        ? new Date(`${b.booking_date}T${b.booking_time}`)
        : b.scheduled_at ? new Date(b.scheduled_at) : null;
      if (d) m.set(appId, d);
    }
    return m;
  }, [allBookings]);

  const [landingById, setLandingById] = useState<Map<string, { slug: string; firmenname: string | null }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("landing_pages").select("id, slug, firmenname");
      if (cancelled || !data) return;
      const m = new Map<string, { slug: string; firmenname: string | null }>();
      for (const l of data as any[]) m.set(l.id, { slug: l.slug, firmenname: l.firmenname ?? null });
      setLandingById(m);
    })();
    return () => { cancelled = true; };
  }, []);

  // Mail-Historie: alle protokollierten Mails je Bewerber (Versand-Log per
  // E-Mail-Adresse, Reminder-Log per application_id). Daraus entsteht die
  // feste 4er-Kette in der Liste und die Historie im Dialog.
  const [mailEventsByApp, setMailEventsByApp] = useState<Map<string, MailEvent[]>>(new Map());
  const [mailSendEventsByApp, setMailSendEventsByApp] = useState<Map<string, MailEvent[]>>(new Map());
  const [mailEventsByEmail, setMailEventsByEmail] = useState<Map<string, MailEvent[]>>(new Map());
  const [mailReload, setMailReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("application_reminder_log")
        .select("application_id, reminder_kind, status, sent_at, error")
        .order("sent_at", { ascending: false })
        .limit(3000);
      if (cancelled || !data) return;
      const m = new Map<string, MailEvent[]>();
      for (const r of data as any[]) {
        const list = m.get(r.application_id) ?? [];
        list.push({
          key: r.reminder_kind,
          label: mailLabel(r.reminder_kind),
          status: r.status ?? "unknown",
          at: r.sent_at,
          error: r.error ?? null,
          source: "reminder_log",
        });
        m.set(r.application_id, list);
      }
      setMailEventsByApp(m);
    })();
    return () => { cancelled = true; };
  }, [applications, mailReload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Vollständiges Zeitfenster statt "neueste 5.000 Zeilen": bei hohem
      // Volumen fielen ältere echte Versände sonst unsichtbar heraus.
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const data = await fetchAll<any>(() =>
        supabase
          .from("email_send_log")
          .select("id, recipient_email, template_name, status, created_at, error_message, metadata")
          // Technische Zeilen (abgelöste Retries, bereinigte Doppelversände) ausblenden.
          .not("status", "in", "(superseded,duplicate)")
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
      ).catch(() => [] as any[]);
      if (cancelled || !data) return;
      const byEmail = new Map<string, MailEvent[]>();
      const byApplication = new Map<string, MailEvent[]>();
      for (const r of data as any[]) {
        const email = String(r.recipient_email ?? "").toLowerCase().trim();
        const applicationId = String(r.metadata?.application_id ?? "").trim();
        const event: MailEvent = {
          key: r.template_name ?? "unbekannt",
          label: mailLabel(r.template_name),
          status: r.status ?? "unknown",
          at: r.created_at,
          error: r.error_message ?? null,
          source: "email_send_log",
          logId: r.id ?? null,
        };
        if (applicationId) {
          const list = byApplication.get(applicationId) ?? [];
          list.push(event);
          byApplication.set(applicationId, list);
        } else if (email) {
          // Legacy-Zeilen ohne application_id bleiben als vorsichtiger Fallback.
          const list = byEmail.get(email) ?? [];
          list.push(event);
          byEmail.set(email, list);
        }
      }
      setMailSendEventsByApp(byApplication);
      setMailEventsByEmail(byEmail);
    })();
    return () => { cancelled = true; };
  }, [applications, mailReload]);


  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const l = landingById.get(id);
    return l ? (l.firmenname || l.slug) : null;
  };
  const resolveSource = (a: any): { from: string | null; to: string | null } => {
    // "Von" = Vermittlungs-Landing (source), "An" = Fasttrack-Landing (target).
    // target_landing_id wird beim Submit aus landing_pages.linked_fasttrack_landing_id
    // eingefroren — bleibt korrekt, auch wenn die Zuordnung später umgehängt wird.
    const from = nameOf(a?.source_landing_id) ?? a?.source_slug ?? null;
    const to = nameOf(a?.target_landing_id);
    return { from, to };
  };


  const rows = useMemo(() => {
    return (applications as any[]).map((a) => {
      const email = String(a.email ?? "").toLowerCase().trim();
      const p = profileByKey.byApplicationId.get(a.id)
        || (a.user_id && profileByKey.byUid.get(a.user_id))
        || (email && profileByKey.byEmail.get(email))
        || null;
      const prof: ProfileInfo = p ? {
        onboarding: p.onboarding_status ?? null,
        status: p.status ?? null,
        emailConfirmed: !!(p.user_id && emailConfirmedUserIds.has(p.user_id)),
        contractSigned: !!p.contract_signed_at,
      } : null;
      const sched = bookingByApp.get(a.id) ?? (a.scheduled_at ? new Date(a.scheduled_at) : null);
      const phase = computePhase(a, sched, prof);
      const mailEvents: MailEvent[] = mergeMailEvents([
        ...(mailSendEventsByApp.get(a.id) ?? []),
        ...(email ? mailEventsByEmail.get(email) ?? [] : []),
        ...(mailEventsByApp.get(a.id) ?? []),
      ]);
      return {
        id: a.id,
        name: a.full_name || `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || email || "—",
        email: a.email || "—",
        phone: a.phone || "—",
        phase,
        tenantId: a.tenant_id ?? null,
        archived: a.is_archived === true,
        lastActivity: a.created_at,
        source: resolveSource(a),
        createdAt: a.created_at,
        hasProfile: !!prof,
        mailEvents,
        // Termin-Mail nur erwartet, wenn tatsächlich ein Termin existiert;
        // Zusage-Mail nur nach angenommener Bewerbung.
        mailExpected: { termin: !!sched, zusage: phase === "angenommen" },
        // Was das System als Nächstes verschickt — macht graue Punkte erklärbar.
        nextStep: computeNextStep({
          createdAt: a.created_at ?? null,
          scheduledAt: sched,
          bookingStatus: a.booking_status ?? null,
          interviewCompletedAt: a.interview_completed_at ?? null,
          recommendation: (a.interview_recommendation as string | null) ?? null,
          inviteSentAt:
            mailEvents.find((e) =>
              ["welcome_invitation", "registration_invitation", "invitation", "reminder_invite", "bewerbung_magic_link"].includes(e.key)
              // "stuck" = im Reminder-Protokoll als versendet vermerkt, im
              // Versand-Log ohne Endstatus. Die Mail ist trotzdem rausgegangen.
              && ["sent", "stuck"].includes(e.status),
            )?.at ?? null,
          registered: !!prof,
          cancelledAt: a.stage_changed_at ?? null,
          inviteMailStatus: a.invite_mail_status ?? null,
          inviteMailError: a.invite_mail_error ?? null,
          inviteMailAt: a.invite_mail_at ?? null,
        }),
      };
    }).sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
  }, [applications, bookingByApp, landingById, profileByKey, emailConfirmedUserIds, mailSendEventsByApp, mailEventsByEmail, mailEventsByApp]);

  // Chips folgen dem echten Weg des Bewerbers — so ist sofort sichtbar,
  // an welcher Stelle Leute verloren gehen.
  const GROUPS: { key: string; label: string; emoji: string; phases: Phase[] }[] = [
    { key: "alle",        label: "Alle",              emoji: "👥", phases: [] },
    { key: "eingegangen", label: "Eingegangen",       emoji: "📥", phases: ["termin_offen"] },
    { key: "termin",      label: "Termin gebucht",    emoji: "⏰", phases: ["termin_gebucht"] },
    { key: "interview",   label: "Interview",         emoji: "🎙", phases: ["interview_laeuft", "auswertung_fehler"] },
    { key: "no_show",     label: "Nicht erschienen",  emoji: "⚠️", phases: ["no_show"] },
    { key: "abgesagt",    label: "Abgesagt",          emoji: "🚫", phases: ["abgesagt"] },
    { key: "zusage",      label: "Zusage erteilt",    emoji: "✅", phases: ["angenommen"] },
    { key: "abgelehnt",   label: "Abgelehnt",         emoji: "❌", phases: ["abgelehnt"] },
    { key: "onboarded",   label: "Onboarded",         emoji: "🚀", phases: ["registriert", "email_bestaetigt", "onboarding_komplett", "mitarbeiter_aktiv"] },
  ];
  const groupOf = (p: Phase): string => GROUPS.find(g => g.phases.includes(p))?.key ?? "alle";

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: scoped.length };
    for (const g of GROUPS) if (g.key !== "alle") c[g.key] = 0;
    for (const r of scoped) {
      const g = groupOf(r.phase);
      c[g] = (c[g] || 0) + 1;
    }
    return c;
  }, [scoped]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return scoped.filter(r => {
      if (tab !== "alle" && groupOf(r.phase) !== tab) return false;
      if (!ql) return true;
      return (
        r.name?.toLowerCase().includes(ql) ||
        r.email?.toLowerCase().includes(ql) ||
        r.phone?.toLowerCase().includes(ql) ||
        (r.source?.from ?? "").toLowerCase().includes(ql) ||
        (r.source?.to ?? "").toLowerCase().includes(ql)
      );
    });
  }, [scoped, tab, q]);
  const pagination = usePagination(filtered, 50);

  const orphanCandidates = useMemo(() => {
    const cutoff = Date.now() - cleanupDays * 86_400_000;
    return rows.filter(r => !r.hasProfile && new Date(r.createdAt).getTime() < cutoff).length;
  }, [rows, cleanupDays]);

  async function doCleanup() {
    setBusy(true);
    try {
      const res: any = await runCleanup({ data: { older_than_days: cleanupDays, dry_run: false } });
      toast.success(`${res.deleted} Bewerbungen gelöscht.`);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Cleanup fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function doBulkDelete() {
    setBulkBusy(true);
    try {
      const ids = Array.from(selected);
      const res: any = await runBulkDelete({ data: { ids } });
      toast.success(`${res.deleted} Bewerbungen gelöscht${res.failures?.length ? ` (${res.failures.length} Fehler)` : ""}.`);
      setSelected(new Set());
      setBulkOpen(false);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk-Löschen fehlgeschlagen");
    } finally {
      setBulkBusy(false);
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) filtered.forEach(r => next.delete(r.id));
    else filtered.forEach(r => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  if (loading) return (
    <div className="p-6 space-y-4"><PageHeaderSkeleton /><TableSkeleton /></div>
  );

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">Bewerbungen</h1>
            <p className="text-sm text-muted-foreground">
              Alle Bewerber im Funnel — bis zur Registrierung als Mitarbeiter.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Name, Rufnummer, E-Mail, Vermittlung…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Trash2 className="h-4 w-4" /> Cleanup
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Verwaiste Bewerbungen löschen</AlertDialogTitle>
                <AlertDialogDescription>
                  Löscht Bewerbungen ohne Registrierung, die älter als N Tage sind.
                  Mitarbeiter bleiben unangetastet.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center gap-2 py-2">
                <label className="text-sm">Älter als</label>
                <Input
                  type="number" min={0} max={3650}
                  value={cleanupDays}
                  onChange={e => setCleanupDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="w-24"
                />
                <span className="text-sm">Tage → betrifft <b>{orphanCandidates}</b> Einträge</span>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction disabled={busy || orphanCandidates === 0} onClick={doCleanup}>
                  {busy ? "Lösche…" : `${orphanCandidates} löschen`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {GROUPS.map(p => {
          const active = tab === p.key;
          const cnt = counts[p.key] ?? 0;
          return (
            <button
              key={p.key}
              onClick={() => navigate(`/admin/bewerbungen?tab=${p.key}`)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground hover:bg-muted"
              }`}
            >
              <span>{p.emoji}</span><span>{p.label}</span>
              <span className={`ml-1 tabular-nums ${active ? "opacity-90" : "text-muted-foreground"}`}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 shadow-sm">
          <div className="text-sm">
            <b>{selected.size}</b> Bewerbung{selected.size === 1 ? "" : "en"} ausgewählt
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
            <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-1.5">
                  <Trash2 className="h-4 w-4" /> {selected.size} löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{selected.size} Bewerbungen löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Endgültige Löschung. Verknüpfte Mitarbeiter-Konten bleiben bestehen und müssen separat gelöscht werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkBusy}>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={bulkBusy}
                    onClick={(e) => { e.preventDefault(); doBulkDelete(); }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {bulkBusy ? "Läuft…" : "Endgültig löschen"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title="Keine Bewerbungen" description="Für diesen Filter sind aktuell keine Einträge vorhanden." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Alle auswählen" />
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Rufnummer</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">E-Mail</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Vermittlung → Fasttrack</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Fortschritt</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Eingegangen</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagination.paged.map(r => {
                    const meta = PHASES.find(x => x.key === r.phase);
                    return (
                      <tr key={r.id} className={`hover:bg-muted/20 ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                        <td className="px-3 py-3">
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} aria-label="Auswählen" />
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <div>{r.name}</div>
                          <div className="text-[10px] text-muted-foreground font-normal mt-0.5 flex flex-wrap items-center gap-1">
                            <span className={`inline-block px-1.5 py-0.5 rounded ${PHASE_COLOR[r.phase]}`}>
                              {meta?.emoji} {meta?.label}
                            </span>
                            <MailChain
                              applicationId={r.id}
                              applicantName={r.name}
                              events={r.mailEvents}
                              expected={r.mailExpected}
                              nextStep={r.nextStep}
                              onRefresh={() => setMailReload((n) => n + 1)}
                            />

                          </div>
                        </td>

                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{r.phone}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.source?.from || r.source?.to ? (
                            <div className="flex flex-col gap-0.5">
                              <span>{r.source.from ?? "—"}</span>
                              {r.source.to && (
                                <span className="text-[10px] opacity-70">→ {r.source.to}</span>
                              )}
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StageTimeline stages={phaseToStages(r.phase)} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString("de-DE") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/personen/${r.id}`)} className="h-7 gap-1.5 text-xs">
                              Öffnen <ExternalLink className="h-3 w-3" />
                            </Button>
                            <ResendInviteButton appId={r.id} />
                            <DeleteAppButton appId={r.id} name={r.name} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-3 py-2">
              <PaginationBar {...pagination} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function DeleteAppButton({ appId, name }: { appId: string; name: string }) {
  return <DeleteAppButtonInner appId={appId} name={name} />;
}

/** Einladung („Willkommen im Team") erneut versenden — z. B. nach SMTP-Fehler. */
function ResendInviteButton({ appId }: { appId: string }) {
  const [busy, setBusy] = useState(false);
  const run = useServerFn(resendRegistrationInvite);
  async function doResend() {
    setBusy(true);
    try {
      const res: any = await run({ data: { applicationId: appId } });
      if (res?.sent) toast.success("Einladung wurde erneut versendet");
      else toast.error(`Versand fehlgeschlagen: ${res?.error ?? res?.reason ?? "unbekannt"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Versand fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={doResend}
      className="h-7 w-7 p-0"
      title="Registrierungs-Einladung erneut senden"
    >
      <MailWarning className="h-3.5 w-3.5" />
    </Button>
  );
}

function DeleteAppButtonInner({ appId, name }: { appId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { loadData } = useAdminData();
  const runDelete = useServerFn(deleteApplication);
  async function doDelete() {
    setBusy(true);
    try {
      await runDelete({ data: { application_id: appId, confirm: "BEWERBUNG LÖSCHEN" } });
      toast.success("Bewerbung gelöscht");
      setOpen(false);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Löschen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
          title="Bewerbung löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bewerbung löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Die Bewerbung von <b>{name}</b> wird endgültig entfernt. Diese Aktion ist nicht rückgängig zu machen.
            Ein bereits verknüpftes Mitarbeiter-Konto bleibt bestehen und muss separat in „Mitarbeiter" gelöscht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); doDelete(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Läuft…" : "Endgültig löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
