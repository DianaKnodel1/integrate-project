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
import { Users, Search, ExternalLink, Trash2, Archive, MessageCircle } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { StageTimeline, type Stage } from "@/components/StageTimeline";
import { deleteOrphanApplications, deleteApplication, bulkDeleteApplications } from "@/lib/admin-delete.functions";
import { archiveOldApplications, resetApplicants } from "@/lib/admin-maintenance.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/PaginationBar";

/**
 * Bewerbungen — nur applications (Funnel bis Registrierung).
 * Mitarbeiter (mit user_id + Profile) verschwinden hier und leben in /admin/mitarbeiter.
 */

type Phase =
  | "termin_offen" | "termin_gebucht" | "abgesagt" | "no_show"
  | "interview_laeuft"
  | "auswertung_fehler"
  | "angenommen" | "abgelehnt"
  | "registriert" | "onboarding_komplett" | "mitarbeiter_aktiv";

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
  onboarding_komplett: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  mitarbeiter_aktiv: "bg-emerald-500 text-white dark:bg-emerald-600 border-0",
};



type ProfileInfo = {
  onboarding: string | null;
  status: string | null;
  contractSigned: boolean;
} | null;

function computePhase(a: any, scheduledAt: Date | null, prof: ProfileInfo): Phase {
  const now = Date.now();
  const rec = a.interview_recommendation as string | null;
  // Profile existiert → tiefer im Funnel
  if (prof) {
    if (prof.status === "angenommen") return "mitarbeiter_aktiv";
    if (prof.onboarding === "abgeschlossen" || prof.contractSigned) return "onboarding_komplett";
    return "registriert";
  }
  // Ein tatsächlich geführtes Interview schlägt jeden Buchungsstatus: Calendly
  // meldet gelegentlich "no_show"/"canceled", obwohl das Gespräch stattfand.
  const attended = !!a.interview_completed_at || !!a.interview_started_at;
  if (!attended && a.booking_status === "no_show") return "no_show";
  if (!attended && a.booking_status === "cancelled") return "abgesagt";
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
    "registriert",
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
    : phase === "registriert" ? 3
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
  const { applications, profiles, allBookings, loadingApplications: loading, loadData } = useAdminData();
  const search = useSearch({ from: "/admin/bewerbungen" });
  const navigate = useNavigate();
  const tab = (search as any).tab ?? "alle";
  const [q, setQ] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);
  const [tenantFilter, setTenantFilter] = useState("");
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveDays, setArchiveDays] = useState(180);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archivePreview, setArchivePreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const runCleanup = useServerFn(deleteOrphanApplications);
  const runBulkDelete = useServerFn(bulkDeleteApplications);
  const runArchive = useServerFn(archiveOldApplications);
  const runResetApplicants = useServerFn(resetApplicants);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");

  useEffect(() => {
    supabase.from("tenants").select("id, name").order("name").then(({ data }) => {
      setTenants((data ?? []) as Array<{ id: string; name: string }>);
    });
  }, []);

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
        contractSigned: !!p.contract_signed_at,
      } : null;
      const sched = bookingByApp.get(a.id) ?? (a.scheduled_at ? new Date(a.scheduled_at) : null);
      const phase = computePhase(a, sched, prof);
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
      };
    }).sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
  }, [applications, bookingByApp, landingById, profileByKey]);

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
    { key: "onboarded",   label: "Onboarded",         emoji: "🚀", phases: ["registriert", "onboarding_komplett", "mitarbeiter_aktiv"] },
  ];
  const groupOf = (p: Phase): string => GROUPS.find(g => g.phases.includes(p))?.key ?? "alle";

  // Grundmenge: Mandanten-Auswahl und Archiv-Schalter gelten für Chips UND Liste,
  // damit Zähler und Tabelle nie auseinanderlaufen.
  const scoped = useMemo(
    () => rows.filter(r => (showArchived ? r.archived : !r.archived) && (!tenantFilter || r.tenantId === tenantFilter)),
    [rows, showArchived, tenantFilter],
  );

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

  async function doArchive() {
    setArchiveBusy(true);
    try {
      const res: any = await runArchive({ data: { older_than_days: archiveDays, dry_run: false } });
      toast.success(`${res.archived} Bewerbungen archiviert.`);
      setArchivePreview(null);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Archivieren fehlgeschlagen");
    } finally {
      setArchiveBusy(false);
    }
  }

  /** Trockenlauf: zeigt vor dem Archivieren, wie viele Datensätze betroffen wären. */
  async function previewArchive() {
    setArchiveBusy(true);
    try {
      const res: any = await runArchive({ data: { older_than_days: archiveDays, dry_run: true } });
      setArchivePreview(res.candidates ?? 0);
    } catch (e: any) {
      toast.error(e?.message ?? "Vorschau fehlgeschlagen");
    } finally {
      setArchiveBusy(false);
    }
  }

  /** Löscht alle Bewerber-Daten. Mitarbeiter-Konten bleiben bestehen. */
  async function doResetApplicants() {
    setResetBusy(true);
    try {
      const res: any = await runResetApplicants({ data: { confirm: "BEWERBER LOESCHEN", dry_run: false } });
      toast.success(`${res.deleted} Bewerbungen gelöscht. Mitarbeiter unverändert.`);
      setResetConfirm("");
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Zurücksetzen fehlgeschlagen");
    } finally {
      setResetBusy(false);
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
