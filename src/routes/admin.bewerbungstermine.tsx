import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/bewerbungstermine")({
  component: AdminApplicantAppointmentsPage,
});

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminListAppointments } from "@/lib/appointments.functions";

const STATUS_FILTERS = [
  { value: "alle", label: "Alle Status" },
  { value: "scheduled", label: "Gebucht" },
  { value: "cancelled", label: "Abgesagt" },
  { value: "completed", label: "Abgeschlossen" },
  { value: "no_show", label: "Nicht erschienen" },
];

function AdminApplicantAppointmentsPage() {
  const listAppointments = useServerFn(adminListAppointments);
  const [filterStatus, setFilterStatus] = useState("alle");

  const q = useQuery({
    queryKey: ["admin-applicant-interview-appointments"],
    queryFn: () => listAppointments({ data: { status: "all" } }),
  });

  const rows = ((q.data as any)?.rows ?? []) as any[];

  const { upcoming, past } = useMemo(() => {
    const filtered = filterStatus === "alle" ? rows : rows.filter((r) => r.status === filterStatus);
    return {
      upcoming: filtered
        .filter((r) => r.status === "scheduled")
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
      past: filtered
        .filter((r) => r.status !== "scheduled")
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    };
  }, [rows, filterStatus]);

  const renderRow = (r: any) => {
    const start = new Date(r.starts_at);
    const app = r.applications ?? {};
    return (
      <tr key={r.id} className="border-t border-border">
        <td className="px-3 py-2 font-medium text-foreground">{app.full_name ?? "Bewerber"}</td>
        <td className="px-3 py-2 text-muted-foreground">{app.email ?? "—"}</td>
        <td className="px-3 py-2 text-muted-foreground">
          {start.toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            timeZone: "Europe/Berlin",
          })}{" "}
          ·{" "}
          {start.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Berlin",
          })}{" "}
          Uhr
        </td>
        <td className="px-3 py-2">
          <Badge variant={r.status === "scheduled" ? "default" : "secondary"}>{labelAppointmentStatus(r.status)}</Badge>
        </td>
      </tr>
    );
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-heading font-bold text-foreground">Bewerbungstermine</h1>
          <p className="text-xs text-muted-foreground">
            {rows.length} Interview-Buchungen aus dem eigenen Buchungssystem
          </p>
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade Bewerbungs-Termine…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Bewerbungs-Termine konnten nicht geladen werden: {(q.error as any)?.message ?? "Unbekannter Fehler"}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Bewerber-Termine gebucht.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 items-start">
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/40">
              Kommende Interviews ({upcoming.length})
            </div>
            <table className="w-full text-sm">
              <tbody>
                {upcoming.length ? upcoming.map(renderRow) : (
                  <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>Keine kommenden Termine.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/40">
              Abgesagt / erledigt / No-Show ({past.length})
            </div>
            <table className="w-full text-sm">
              <tbody>
                {past.length ? past.map(renderRow) : (
                  <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>Noch keine vergangenen Einträge.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function labelAppointmentStatus(status: string) {
  if (status === "scheduled") return "Gebucht";
  if (status === "cancelled") return "Abgesagt";
  if (status === "no_show") return "Nicht erschienen";
  if (status === "completed") return "Abgeschlossen";
  return status;
}