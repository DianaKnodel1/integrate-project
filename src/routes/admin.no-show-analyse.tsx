// No-Show-Analyse — wo genau verlieren wir die Bewerber?

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getNoShowReport, type Bucket, type NoShowReport } from "@/lib/no-show-analysis.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/no-show-analyse")({
  component: NoShowPage,
  head: () => ({
    meta: [
      { title: "No-Show-Analyse | Portal Admin" },
      { name: "description", content: "Analyse der nicht wahrgenommenen Bewerbungstermine nach Vorlaufzeit, Uhrzeit, Quelle und Erinnerungsmails." },
    ],
  }),
});

const PRESETS = [7, 14, 30, 90];

function Quote({ value }: { value: number }) {
  return (
    <span className={cn(
      "font-semibold tabular-nums",
      value >= 60 ? "text-destructive" : value >= 40 ? "text-amber-600" : "text-emerald-600",
    )}>
      {value}%
    </span>
  );
}

function BucketTable({ title, description, rows }: { title: string; description: string; rows: Bucket[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.gebucht), 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {r.no_show}/{r.erschienen + r.no_show} · <Quote value={r.no_show_quote} />
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary/70"
                  style={{ width: `${Math.round((r.gebucht / max) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NoShowPage() {
  const fn = useServerFn(getNoShowReport);
  const [days, setDays] = useState(7);
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [report, setReport] = useState<NoShowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("tenants").select("id, name").order("name").then(({ data }) => {
      setTenants((data ?? []) as Array<{ id: string; name: string }>);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const payload: Record<string, unknown> = { days };
    if (tenantId) payload["tenant_id"] = tenantId;
    fn({ data: payload as never })
      .then((r) => { if (!cancelled) { setReport(r); if (r.error) setErr(r.error); } })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Fehler"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, tenantId, fn]);

  const t = report?.totals;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">No-Show-Analyse</h1>
          <p className="text-sm text-muted-foreground">
            Warum erscheinen gebuchte Bewerber nicht? Ausgewertet werden nur Termine, die bereits stattgefunden haben.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d} Tage
            </Button>
          ))}
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            aria-label="Mandant filtern"
          >
            <option value="">Alle Mandanten</option>
            {tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setDays((d) => d)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {t && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Bewerbungen", value: t.beworben },
            { label: "davon gebucht", value: `${t.buchungsquote}%` },
            { label: "Termine (vergangen)", value: t.gebucht },
            { label: "erschienen", value: `${t.erschienen} · ${t.erscheinensquote}%` },
            { label: "No-Shows", value: `${t.no_show_quote}%` },
            { label: "abgesagt / Abbruch", value: `${t.abgesagt} / ${t.unklar}` },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {report && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Befunde</CardTitle>
            <CardDescription>Automatisch erkannte Muster (ab 10 Terminen je Gruppe)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {f.level === "info"
                  ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  : <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", f.level === "high" ? "text-destructive" : "text-amber-600")} />}
                <span>{f.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketTable title="Erinnerungsmails" description="Hat der Bewerber Bestätigung und Erinnerungen wirklich bekommen?" rows={report.by_mail} />
          <BucketTable title="Vorlaufzeit" description="Zeit zwischen Buchung und Termin" rows={report.by_lead_time} />
          <BucketTable title="Reaktionszeit" description="Zeit zwischen Bewerbung und Buchung" rows={report.by_reaction_time} />
          <BucketTable title="Uhrzeit des Termins" description="Terminstart in Europe/Berlin" rows={report.by_hour} />
          <BucketTable title="Wochentag" description="Terminstart in Europe/Berlin" rows={report.by_weekday} />
          <BucketTable title="Quelle / Landingpage" description="Woher kam der Bewerber?" rows={report.by_source} />
          <BucketTable title="Mandant" description="No-Show-Quote je Vermittlung" rows={report.by_tenant} />
        </div>
      )}
    </div>
  );
}