import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Calendar as CalendarIcon, Clock, Loader2 } from "lucide-react";
import {
  adminListSchedules,
  adminUpsertSchedule,
  adminDeleteSchedule,
  adminListRules,
  adminReplaceRules,
  adminListExceptions,
  adminUpsertException,
  adminDeleteException,
  adminSyncSchedule,
} from "@/lib/appointments.functions";

export const Route = createFileRoute("/admin/verfuegbarkeit")({
  component: AdminAvailabilityPage,
});

const WEEKDAYS = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 0, label: "So" },
];

interface RuleDraft { weekday: number; start_time: string; end_time: string }

function AdminAvailabilityPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListSchedules);
  const upsertFn = useServerFn(adminUpsertSchedule);
  const delFn = useServerFn(adminDeleteSchedule);

  const schedules = useQuery({ queryKey: ["schedules"], queryFn: () => listFn() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [landingPages, setLandingPages] = useState<Array<{ id: string; slug: string | null; tenant_id: string | null; linked_fasttrack_landing_id?: string | null }>>([]);
  const syncFn = useServerFn(adminSyncSchedule);

  useMemo(() => {
    supabase.from("landing_pages").select("id, slug, tenant_id, linked_fasttrack_landing_id").order("slug").then(({ data }) => {
      if (data) setLandingPages(data as any);
    });
  }, []);

  const selected = schedules.data?.rows.find((r: any) => r.id === selectedId);

  // Partner-Landing (Vermittlung ⇄ Fast-Track) des gewählten Kalenders
  const partnerLanding = useMemo(() => {
    const lpId = (selected as any)?.landing_page_id;
    if (!lpId) return null;
    const own = landingPages.find((l) => l.id === lpId);
    if (own?.linked_fasttrack_landing_id) {
      return landingPages.find((l) => l.id === own.linked_fasttrack_landing_id) ?? null;
    }
    return landingPages.find((l) => l.linked_fasttrack_landing_id === lpId) ?? null;
  }, [selected, landingPages]);

  const syncMut = useMutation({
    mutationFn: (id: string) => syncFn({ data: { schedule_id: id } }),
    onSuccess: () => {
      toast({ title: "Termine gespiegelt", description: "Die verknüpfte Landing hat jetzt dieselben Zeiten." });
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e: any) => toast({ title: "Fehler", description: e?.message, variant: "destructive" }),
  });

  const upsertMut = useMutation({
    mutationFn: (payload: any) => upsertFn({ data: payload }),
    onSuccess: (res) => {
      toast({ title: "Gespeichert" });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      if (res.id) setSelectedId(res.id);
    },
    onError: (e: any) => toast({ title: "Fehler", description: e?.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast({ title: "Gelöscht" });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setSelectedId(null);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Verfügbarkeiten</h1>
        <p className="text-sm text-muted-foreground">
          Kalender pro Landing-Page. Ersetzt für diese Landing-Page Calendly durch das eigene Buchungssystem.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">Kalender</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => upsertMut.mutate({
                name: "Neuer Kalender",
                timezone: "Europe/Berlin",
                slot_duration_minutes: 30,
                buffer_before_minutes: 0,
                buffer_after_minutes: 0,
                min_notice_hours: 0,
                max_days_ahead: 21,
                active: true,
              })}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {schedules.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {schedules.data?.rows.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${selectedId === s.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
              >
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.slot_duration_minutes} Min · {s.active ? "aktiv" : "inaktiv"}
                </div>
              </button>
            ))}
            {schedules.data && schedules.data.rows.length === 0 && (
              <div className="text-xs text-muted-foreground p-3">Noch keine Kalender.</div>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <div className="space-y-4">
            {partnerLanding && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 text-xs flex items-center justify-between gap-3">
                <div>
                  🔗 <strong>Verknüpfte Seiten:</strong> Diese Zeiten gelten automatisch auch für{" "}
                  <strong>{partnerLanding.slug ?? partnerLanding.id.slice(0, 8)}</strong>. Beim Speichern wird
                  dort derselbe Terminplan (Wochenzeiten, Slot-Dauer, Vorlauf, Sperrtage) hinterlegt.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={syncMut.isPending}
                  onClick={() => syncMut.mutate(selected.id)}
                >
                  {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Jetzt spiegeln"}
                </Button>
              </div>
            )}
          <ScheduleDetail
            key={selected.id}
            schedule={selected}
            landingPages={landingPages}
            onSave={(p) => upsertMut.mutate(p)}
            onDelete={() => {
              if (confirm("Kalender wirklich löschen? Bestehende Buchungen bleiben erhalten.")) {
                deleteMut.mutate(selected.id);
              }
            }}
          />
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
            Wählen Sie links einen Kalender oder legen Sie einen neuen an.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function ScheduleDetail({ schedule, landingPages, onSave, onDelete }: {
  schedule: any;
  landingPages: Array<{ id: string; slug: string | null; tenant_id: string | null }>;
  onSave: (p: any) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    id: schedule.id,
    tenant_id: schedule.tenant_id,
    landing_page_id: schedule.landing_page_id,
    name: schedule.name,
    timezone: schedule.timezone,
    slot_duration_minutes: schedule.slot_duration_minutes,
    buffer_before_minutes: schedule.buffer_before_minutes,
    buffer_after_minutes: schedule.buffer_after_minutes,
    min_notice_hours: schedule.min_notice_hours,
    max_days_ahead: schedule.max_days_ahead,
    active: schedule.active,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Einstellungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Landing-Page</Label>
              <Select
                value={form.landing_page_id ?? ""}
                onValueChange={v => {
                  const lp = landingPages.find(l => l.id === v);
                  setForm({ ...form, landing_page_id: v || null, tenant_id: lp?.tenant_id ?? form.tenant_id });
                }}
              >
                <SelectTrigger><SelectValue placeholder="– keine –" /></SelectTrigger>
                <SelectContent>
                  {landingPages.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.slug ?? l.id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Slot-Dauer (Min)</Label>
              <Input type="number" min={5} max={240} value={form.slot_duration_minutes}
                onChange={e => setForm({ ...form, slot_duration_minutes: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Zeitzone</Label>
              <Input value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} />
            </div>
            <div>
              <Label>Vorlaufzeit (Std)</Label>
              <Input type="number" min={0} max={168} value={form.min_notice_hours}
                onChange={e => setForm({ ...form, min_notice_hours: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Max. Tage im Voraus</Label>
              <Input type="number" min={1} max={180} value={form.max_days_ahead}
                onChange={e => setForm({ ...form, max_days_ahead: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Puffer vorher (Min)</Label>
              <Input type="number" min={0} max={120} value={form.buffer_before_minutes}
                onChange={e => setForm({ ...form, buffer_before_minutes: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Puffer nachher (Min)</Label>
              <Input type="number" min={0} max={120} value={form.buffer_after_minutes}
                onChange={e => setForm({ ...form, buffer_after_minutes: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
            <Label className="!m-0">Aktiv (Bewerber können buchen)</Label>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onSave(form)}><Save className="h-4 w-4 mr-2" /> Speichern</Button>
            <Button variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4 mr-2" /> Löschen</Button>
          </div>
        </CardContent>
      </Card>

      <RulesEditor scheduleId={schedule.id} slotMinutes={Number(form.slot_duration_minutes) || 30} />
      <ExceptionsEditor scheduleId={schedule.id} />
    </div>
  );
}

function slotPreview(start: string, end: string, slotMinutes: number) {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const s = toMin(start), e = toMin(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || slotMinutes <= 0) return null;
  const count = Math.floor((e - s) / slotMinutes);
  if (count < 1) return { count: 0, last: null as string | null };
  const lastStart = s + (count - 1) * slotMinutes;
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { count, last: fmt(lastStart) };
}

function RulesEditor({ scheduleId, slotMinutes }: { scheduleId: string; slotMinutes: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRules);
  const saveFn = useServerFn(adminReplaceRules);

  const q = useQuery({
    queryKey: ["rules", scheduleId],
    queryFn: () => listFn({ data: { schedule_id: scheduleId } }),
  });

  const [draft, setDraft] = useState<RuleDraft[] | null>(null);
  const rules = draft ?? (q.data?.rows.map((r: any) => ({
    weekday: r.weekday,
    start_time: r.start_time.slice(0, 5),
    end_time: r.end_time.slice(0, 5),
  })) ?? []);

  // Ende muss nach dem Start liegen (DB-Constraint). Nacht-Fenster (08:00–02:00)
  // müssen in zwei Zeilen aufgeteilt werden, z. B. 08:00–23:59.
  const invalidIdx = rules
    .map((r, i) => (r.start_time && r.end_time && r.end_time <= r.start_time ? i : -1))
    .filter(i => i >= 0);

  const save = useMutation({
    mutationFn: async () => {
      if (invalidIdx.length > 0) {
        throw new Error(
          "Bei mindestens einer Zeile liegt die Endzeit vor oder gleich der Startzeit. " +
          "Zeitfenster über Mitternacht bitte aufteilen (z. B. 08:00–23:59 und am Folgetag 00:00–02:00).",
        );
      }
      return saveFn({ data: { schedule_id: scheduleId, rules } });
    },
    onSuccess: () => {
      toast({ title: "Wochenraster gespeichert" });
      qc.invalidateQueries({ queryKey: ["rules", scheduleId] });
      setDraft(null);
    },
    onError: (e: any) => toast({ title: "Fehler", description: e?.message, variant: "destructive" }),
  });


  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Wochenraster</CardTitle>
        <CardDescription>Wann finden regelmäßig Bewerbungsgespräche statt?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Ein Termin muss vollständig <strong>innerhalb</strong> des Fensters liegen. Bei {slotMinutes} Min.
          Slot-Dauer ist der letzte Start also {slotMinutes} Min. vor der Endzeit (z.&nbsp;B. 09:00–12:00 → letzter
          Termin {slotPreview("09:00", "12:00", slotMinutes)?.last ?? "–"}). Für Termine bis Mitternacht die Endzeit
          auf 23:59 setzen.
        </p>
        {rules.map((r, idx) => {
          const preview = slotPreview(r.start_time, r.end_time, slotMinutes);
          return (
          <div key={idx} className="flex flex-wrap items-center gap-2">
            <Select value={String(r.weekday)}
              onValueChange={v => setDraft(rules.map((x, i) => i === idx ? { ...x, weekday: Number(v) } : x))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map(d => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="time" value={r.start_time} className="w-28"
              onChange={e => setDraft(rules.map((x, i) => i === idx ? { ...x, start_time: e.target.value } : x))} />
            <span>–</span>
            <Input type="time" value={r.end_time}
              className={`w-28 ${invalidIdx.includes(idx) ? "border-destructive text-destructive" : ""}`}
              onChange={e => setDraft(rules.map((x, i) => i === idx ? { ...x, end_time: e.target.value } : x))} />
            <Button variant="ghost" size="icon"
              onClick={() => setDraft(rules.filter((_, i) => i !== idx))}>
              <Trash2 className="h-4 w-4" />
            </Button>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {preview.count === 0
                  ? "kein Termin – Fenster kürzer als die Slot-Dauer"
                  : `${preview.count} Termine · letzter Start ${preview.last} Uhr`}
              </span>
            )}
          </div>
          );
        })}
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">Noch keine Regeln. Fügen Sie unten eine hinzu.</p>
        )}
        {invalidIdx.length > 0 && (
          <p className="text-xs text-destructive">
            Endzeit muss nach der Startzeit liegen. Fenster über Mitternacht bitte aufteilen:
            z. B. 08:00–23:59 und am Folgetag 00:00–02:00.
          </p>
        )}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm"
            onClick={() => setDraft([...rules, { weekday: 1, start_time: "09:00", end_time: "12:00" }])}>
            <Plus className="h-4 w-4 mr-1" /> Zeile hinzufügen
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !draft || invalidIdx.length > 0}>
            <Save className="h-4 w-4 mr-2" /> Speichern
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}

function ExceptionsEditor({ scheduleId }: { scheduleId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListExceptions);
  const upsertFn = useServerFn(adminUpsertException);
  const delFn = useServerFn(adminDeleteException);

  const q = useQuery({
    queryKey: ["exceptions", scheduleId],
    queryFn: () => listFn({ data: { schedule_id: scheduleId } }),
  });

  const [date, setDate] = useState("");
  const [blocked, setBlocked] = useState(true);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: () => upsertFn({ data: {
      schedule_id: scheduleId, exception_date: date, is_blocked: blocked,
      start_time: blocked ? undefined : start,
      end_time: blocked ? undefined : end,
      note: note || undefined,
    } }),
    onSuccess: () => {
      toast({ title: "Ausnahme gespeichert" });
      qc.invalidateQueries({ queryKey: ["exceptions", scheduleId] });
      setDate(""); setNote("");
    },
    onError: (e: any) => toast({ title: "Fehler", description: e?.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions", scheduleId] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><CalendarIcon className="h-4 w-4" /> Ausnahmen</CardTitle>
        <CardDescription>Urlaub, Feiertage oder Extra-Termine.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(q.data?.rows ?? []).map((e: any) => (
          <div key={e.id} className="flex items-center gap-2 text-sm border rounded px-3 py-2">
            <div className="font-medium w-28">{e.exception_date}</div>
            {e.is_blocked ? (
              <Badge variant="destructive">geblockt</Badge>
            ) : (
              <Badge>{e.start_time?.slice(0, 5)} – {e.end_time?.slice(0, 5)}</Badge>
            )}
            {e.note && <span className="text-muted-foreground truncate">{e.note}</span>}
            <Button variant="ghost" size="icon" className="ml-auto" onClick={() => del.mutate(e.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="border-t pt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Datum</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={blocked} onCheckedChange={setBlocked} />
              <Label className="!m-0 text-xs">{blocked ? "Ganzen Tag blockieren" : "Extra-Fenster"}</Label>
            </div>
            {!blocked && (
              <>
                <div>
                  <Label className="text-xs">Von</Label>
                  <Input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-28" />
                </div>
                <div>
                  <Label className="text-xs">Bis</Label>
                  <Input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-28" />
                </div>
              </>
            )}
            <div className="flex-1 min-w-[150px]">
              <Label className="text-xs">Notiz</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="z.B. Urlaub" />
            </div>
            <Button size="sm" onClick={() => add.mutate()} disabled={!date}>
              <Plus className="h-4 w-4 mr-1" /> Hinzufügen
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
