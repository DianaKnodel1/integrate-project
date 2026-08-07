// No-Show-Diagnose — warum erscheinen gebuchte Bewerber nicht?
//
// Wertet je gebuchtem Termin aus, ob er wahrgenommen, abgesagt oder still
// verfallen ist, und schlüsselt die No-Show-Quote nach den Faktoren auf, die
// man tatsächlich beeinflussen kann:
//   - Vorlaufzeit (Buchung -> Termin)
//   - Reaktionszeit (Bewerbung -> Buchung)
//   - Wochentag und Uhrzeit des Termins
//   - Mandant und Quelle/Landingpage
//   - tatsächlich zugestellte Erinnerungsmails (Bestätigung / 24 h / 30 min)
//
// Bewusst read-only: die Funktion verändert nichts, sie liest nur.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  days: z.number().int().min(1).max(365).default(7),
  tenant_id: z.string().uuid().optional(),
});

export type Bucket = {
  key: string;
  label: string;
  gebucht: number;
  erschienen: number;
  abgesagt: number;
  no_show: number;
  unklar: number;
  no_show_quote: number; // no_show / (gebucht - abgesagt)
};

export type NoShowTotals = {
  beworben: number;
  gebucht: number;
  erschienen: number;
  abgesagt: number;
  no_show: number;
  unklar: number;
  nie_gebucht: number;
  buchungsquote: number;
  erscheinensquote: number;
  no_show_quote: number;
  mehrfachbuchungen: number;
};

export type NoShowReport = {
  totals: NoShowTotals;
  by_lead_time: Bucket[];
  by_reaction_time: Bucket[];
  by_weekday: Bucket[];
  by_hour: Bucket[];
  by_tenant: Bucket[];
  by_source: Bucket[];
  by_mail: Bucket[];
  findings: Array<{ level: "high" | "medium" | "info"; text: string }>;
  error?: string;
};

const TZ = "Europe/Berlin";
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function berlinParts(iso: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("de-DE", {
    timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const hour = Number(f.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = new Date(
    new Date(d).toLocaleString("en-US", { timeZone: TZ }),
  ).getDay();
  return { hour, weekday };
}

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, gebucht: 0, erschienen: 0, abgesagt: 0, no_show: 0, unklar: 0, no_show_quote: 0 };
}

function finalize(map: Map<string, Bucket>, order?: string[]): Bucket[] {
  const list = Array.from(map.values());
  for (const b of list) {
    // Nur eindeutig bewertete Termine zaehlen — 'unklar' verzerrt sonst die Quote.
    const relevant = b.erschienen + b.no_show;
    b.no_show_quote = relevant > 0 ? Math.round((b.no_show / relevant) * 1000) / 10 : 0;
  }
  if (order) {
    list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else {
    list.sort((a, b) => b.gebucht - a.gebucht);
  }
  return list;
}

const LEAD_ORDER = ["<6h", "6-24h", "1-2d", "2-3d", "3-7d", ">7d"];
function leadBucket(hours: number): string {
  if (hours < 6) return "<6h";
  if (hours < 24) return "6-24h";
  if (hours < 48) return "1-2d";
  if (hours < 72) return "2-3d";
  if (hours < 168) return "3-7d";
  return ">7d";
}
const LEAD_LABEL: Record<string, string> = {
  "<6h": "unter 6 Stunden Vorlauf",
  "6-24h": "6–24 Stunden Vorlauf",
  "1-2d": "1–2 Tage Vorlauf",
  "2-3d": "2–3 Tage Vorlauf",
  "3-7d": "3–7 Tage Vorlauf",
  ">7d": "über 7 Tage Vorlauf",
};

const REACT_ORDER = ["same-day", "1d", "2-3d", "4-7d", ">7d"];
function reactBucket(hours: number): string {
  if (hours < 24) return "same-day";
  if (hours < 48) return "1d";
  if (hours < 96) return "2-3d";
  if (hours < 168) return "4-7d";
  return ">7d";
}
const REACT_LABEL: Record<string, string> = {
  "same-day": "am Bewerbungstag gebucht",
  "1d": "1 Tag nach Bewerbung",
  "2-3d": "2–3 Tage nach Bewerbung",
  "4-7d": "4–7 Tage nach Bewerbung",
  ">7d": "später als 7 Tage",
};

const MAIL_TEMPLATES = [
  "booking_confirmation",
  "interview_reminder_24h",
  "interview_invite_30min",
];

export const getNoShowReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<NoShowReport> => {
    const { supabase } = context;
    const sinceIso = new Date(Date.now() - data.days * 86400_000).toISOString();
    const nowMs = Date.now();

    const empty: NoShowReport = {
      totals: {
        beworben: 0, gebucht: 0, erschienen: 0, abgesagt: 0, no_show: 0, unklar: 0, nie_gebucht: 0,
        buchungsquote: 0, erscheinensquote: 0, no_show_quote: 0, mehrfachbuchungen: 0,
      },
      by_lead_time: [], by_reaction_time: [], by_weekday: [], by_hour: [],
      by_tenant: [], by_source: [], by_mail: [], findings: [],
    };

    // 1) Bewerbungen im Zeitraum
    let appQ = supabase
      .from("applications")
      .select("id, email, tenant_id, created_at, booking_status, scheduled_at, interview_started_at, interview_completed_at, source_slug, source_landing_id, is_test")
      .eq("is_test", false)
      .gte("created_at", sinceIso);
    if (data.tenant_id) appQ = appQ.eq("tenant_id", data.tenant_id);
    const { data: appsRaw, error: appErr } = await appQ;
    if (appErr) return { ...empty, error: appErr.message };
    const apps = (appsRaw ?? []) as any[];
    if (apps.length === 0) return empty;

    const appById = new Map<string, any>(apps.map((a) => [a.id, a]));
    const appIds = apps.map((a) => a.id);

    // 2) Termine zu diesen Bewerbungen
    const appts: any[] = [];
    for (let i = 0; i < appIds.length; i += 300) {
      const { data: chunk } = await supabase
        .from("interview_appointments")
        .select("id, application_id, tenant_id, starts_at, status, created_at, cancelled_at, cancelled_by, rescheduled_from_id")
        .in("application_id", appIds.slice(i, i + 300));
      appts.push(...((chunk ?? []) as any[]));
    }

    // 3) Zugestellte Mails je Empfänger
    const emails = Array.from(new Set(apps.map((a) => String(a.email ?? "").toLowerCase().trim()).filter(Boolean)));
    const mailsByEmail = new Map<string, Set<string>>();
    for (let i = 0; i < emails.length; i += 300) {
      const { data: mails } = await supabase
        .from("email_send_log")
        .select("recipient_email, template_name, status")
        .eq("status", "sent")
        .in("template_name", MAIL_TEMPLATES)
        .in("recipient_email", emails.slice(i, i + 300));
      for (const m of (mails ?? []) as any[]) {
        const key = String(m.recipient_email ?? "").toLowerCase().trim();
        if (!key) continue;
        if (!mailsByEmail.has(key)) mailsByEmail.set(key, new Set());
        mailsByEmail.get(key)!.add(m.template_name);
      }
    }

    // 4) Label-Quellen
    const tenantName = new Map<string, string>();
    const { data: tenants } = await supabase.from("tenants").select("id, name");
    for (const t of (tenants ?? []) as any[]) tenantName.set(t.id, t.name);

    const landingIds = Array.from(new Set(apps.map((a) => a.source_landing_id).filter(Boolean))) as string[];
    const landingLabel = new Map<string, string>();
    if (landingIds.length) {
      const { data: lps } = await supabase.from("landing_pages").select("id, slug, domain").in("id", landingIds);
      for (const l of (lps ?? []) as any[]) landingLabel.set(l.id, l.domain || l.slug || l.id);
    }

    // ---- Aggregation -------------------------------------------------------
    const buckets = {
      lead: new Map<string, Bucket>(),
      react: new Map<string, Bucket>(),
      weekday: new Map<string, Bucket>(),
      hour: new Map<string, Bucket>(),
      tenant: new Map<string, Bucket>(),
      source: new Map<string, Bucket>(),
      mail: new Map<string, Bucket>(),
    };
    const push = (m: Map<string, Bucket>, key: string, label: string, kind: "erschienen" | "abgesagt" | "no_show" | "unklar") => {
      let b = m.get(key);
      if (!b) { b = emptyBucket(key, label); m.set(key, b); }
      b.gebucht += 1;
      b[kind] += 1;
    };

    const totals = { ...empty.totals };
    totals.beworben = apps.length;

    const bookedAppIds = new Set<string>();
    const apptCountByApp = new Map<string, number>();

    for (const ap of appts) {
      const app = appById.get(ap.application_id);
      if (!app) continue;
      const startMs = new Date(ap.starts_at).getTime();
      // Nur vergangene Termine bewerten — künftige sagen nichts über No-Shows.
      if (!Number.isFinite(startMs) || startMs > nowMs) continue;

      bookedAppIds.add(ap.application_id);
      apptCountByApp.set(ap.application_id, (apptCountByApp.get(ap.application_id) ?? 0) + 1);

      // Streng nach dem tatsaechlichen Terminstatus bewerten.
      // 'interview_started_at' bedeutet NUR, dass der Bewerber den Interview-
      // Prozess irgendwann angestossen hat — nicht, dass er zum Termin erschien.
      // Termine, die vorbei sind und trotzdem noch auf 'scheduled' stehen,
      // sind unbewertet ('unklar') und werden nicht als Erfolg gezaehlt.
      const kind: "erschienen" | "abgesagt" | "no_show" | "unklar" =
        ap.status === "cancelled" ? "abgesagt"
        : ap.status === "completed" ? "erschienen"
        : ap.status === "no_show" ? "no_show"
        : "unklar";

      totals.gebucht += 1;
      totals[kind] += 1;

      const bookedMs = new Date(ap.created_at).getTime();
      const leadH = (startMs - bookedMs) / 3_600_000;
      const lk = leadBucket(Math.max(0, leadH));
      push(buckets.lead, lk, LEAD_LABEL[lk] ?? lk, kind);

      const reactH = (bookedMs - new Date(app.created_at).getTime()) / 3_600_000;
      const rk = reactBucket(Math.max(0, reactH));
      push(buckets.react, rk, REACT_LABEL[rk] ?? rk, kind);

      const { hour, weekday } = berlinParts(ap.starts_at);
      push(buckets.weekday, String(weekday), WEEKDAYS[weekday] ?? "?", kind);
      push(buckets.hour, String(hour).padStart(2, "0"), `${String(hour).padStart(2, "0")}:00 Uhr`, kind);

      const tid = ap.tenant_id ?? app.tenant_id ?? "unbekannt";
      push(buckets.tenant, tid, tenantName.get(tid) ?? "Unbekannt", kind);

      const srcId = app.source_landing_id;
      const srcKey = srcId && landingLabel.has(srcId) ? srcId : app.source_slug ? `slug:${app.source_slug}` : "unbekannt";
      const srcLabel = srcId && landingLabel.has(srcId) ? landingLabel.get(srcId)! : app.source_slug || "Unbekannt";
      push(buckets.source, srcKey, srcLabel, kind);

      const sent = mailsByEmail.get(String(app.email ?? "").toLowerCase().trim()) ?? new Set<string>();
      const has24 = sent.has("interview_reminder_24h");
      const has30 = sent.has("interview_invite_30min");
      const hasConf = sent.has("booking_confirmation");
      const mailKey = !hasConf ? "keine_bestaetigung" : has24 && has30 ? "beide" : has30 ? "nur_30min" : has24 ? "nur_24h" : "keine_erinnerung";
      const mailLabel: Record<string, string> = {
        keine_bestaetigung: "Keine Buchungsbestätigung zugestellt",
        beide: "24-h- und 30-min-Erinnerung zugestellt",
        nur_30min: "Nur 30-min-Erinnerung",
        nur_24h: "Nur 24-h-Erinnerung",
        keine_erinnerung: "Bestätigung, aber keine Erinnerung",
      };
      push(buckets.mail, mailKey, mailLabel[mailKey]!, kind);
    }

    totals.nie_gebucht = apps.filter((a) => !bookedAppIds.has(a.id) && !a.scheduled_at).length;
    totals.mehrfachbuchungen = Array.from(apptCountByApp.values()).filter((n) => n > 1).length;
    const relevant = totals.gebucht - totals.abgesagt;
    totals.buchungsquote = totals.beworben ? Math.round((bookedAppIds.size / totals.beworben) * 1000) / 10 : 0;
    totals.erscheinensquote = relevant ? Math.round((totals.erschienen / relevant) * 1000) / 10 : 0;
    totals.no_show_quote = relevant ? Math.round((totals.no_show / relevant) * 1000) / 10 : 0;

    const by_lead_time = finalize(buckets.lead, LEAD_ORDER);
    const by_reaction_time = finalize(buckets.react, REACT_ORDER);
    const by_weekday = finalize(buckets.weekday, ["1", "2", "3", "4", "5", "6", "0"]);
    const by_hour = finalize(buckets.hour).sort((a, b) => a.key.localeCompare(b.key));
    const by_tenant = finalize(buckets.tenant);
    const by_source = finalize(buckets.source);
    const by_mail = finalize(buckets.mail);

    // ---- Automatische Befunde ---------------------------------------------
    const findings: NoShowReport["findings"] = [];
    const MIN_N = 10;

    const noMail = by_mail.find((b) => b.key === "keine_bestaetigung");
    if (noMail && noMail.gebucht >= 5) {
      findings.push({
        level: "high",
        text: `${noMail.gebucht} Termine ohne zugestellte Buchungsbestätigung (No-Show-Quote ${noMail.no_show_quote}%). Diese Bewerber wussten faktisch nichts von ihrem Termin — SMTP-/Zustellprobleme prüfen.`,
      });
    }
    const no30 = by_mail.find((b) => b.key === "nur_24h" || b.key === "keine_erinnerung");
    const both = by_mail.find((b) => b.key === "beide");
    if (no30 && both && no30.gebucht >= MIN_N && no30.no_show_quote > both.no_show_quote + 10) {
      findings.push({
        level: "high",
        text: `Ohne 30-Minuten-Erinnerung liegt die No-Show-Quote bei ${no30.no_show_quote}% statt ${both.no_show_quote}%. Die Erinnerungskette erreicht nicht alle Termine.`,
      });
    }

    const worstLead = by_lead_time.filter((b) => b.gebucht >= MIN_N).sort((a, b) => b.no_show_quote - a.no_show_quote)[0];
    const bestLead = by_lead_time.filter((b) => b.gebucht >= MIN_N).sort((a, b) => a.no_show_quote - b.no_show_quote)[0];
    if (worstLead && bestLead && worstLead.key !== bestLead.key && worstLead.no_show_quote > bestLead.no_show_quote + 10) {
      findings.push({
        level: "medium",
        text: `Vorlaufzeit wirkt: „${worstLead.label}“ ${worstLead.no_show_quote}% No-Show gegenüber „${bestLead.label}“ ${bestLead.no_show_quote}%.`,
      });
    }

    const worstSlot = by_hour.filter((b) => b.gebucht >= MIN_N).sort((a, b) => b.no_show_quote - a.no_show_quote)[0];
    if (worstSlot && worstSlot.no_show_quote > totals.no_show_quote + 15) {
      findings.push({
        level: "medium",
        text: `Uhrzeit ${worstSlot.label}: ${worstSlot.no_show_quote}% No-Show bei ${worstSlot.gebucht} Terminen — deutlich über dem Schnitt (${totals.no_show_quote}%).`,
      });
    }

    const worstSource = by_source.filter((b) => b.gebucht >= MIN_N).sort((a, b) => b.no_show_quote - a.no_show_quote)[0];
    if (worstSource && worstSource.no_show_quote > totals.no_show_quote + 15) {
      findings.push({
        level: "high",
        text: `Quelle „${worstSource.label}“ liefert ${worstSource.no_show_quote}% No-Shows bei ${worstSource.gebucht} Terminen — hier verbrennt der Traffic.`,
      });
    }

    const worstTenant = by_tenant.filter((b) => b.gebucht >= MIN_N).sort((a, b) => b.no_show_quote - a.no_show_quote)[0];
    if (worstTenant && worstTenant.no_show_quote > totals.no_show_quote + 15) {
      findings.push({
        level: "medium",
        text: `Mandant „${worstTenant.label}“ liegt mit ${worstTenant.no_show_quote}% klar über dem Schnitt — Absender, Vorlagen und Terminzeiten dort prüfen.`,
      });
    }

    if (totals.abgesagt > 0 && totals.abgesagt / Math.max(1, totals.gebucht) > 0.15) {
      findings.push({
        level: "info",
        text: `${totals.abgesagt} Termine wurden aktiv abgesagt (${Math.round((totals.abgesagt / totals.gebucht) * 100)}%) — diese Bewerber sind erreichbar und ein guter Kandidat für automatische Neubuchung.`,
      });
    }
    if (totals.nie_gebucht > 0) {
      findings.push({
        level: "info",
        text: `${totals.nie_gebucht} von ${totals.beworben} Bewerbungen haben nie einen Termin gebucht (${Math.round((totals.nie_gebucht / totals.beworben) * 100)}%) — der größere Verlust liegt oft vor dem Termin.`,
      });
    }
    if (!findings.length) {
      findings.push({ level: "info", text: "Keine auffälligen Muster über den Schwellwerten — die No-Shows verteilen sich gleichmäßig." });
    }

    return {
      totals, by_lead_time, by_reaction_time, by_weekday, by_hour,
      by_tenant, by_source, by_mail, findings,
    };
  });