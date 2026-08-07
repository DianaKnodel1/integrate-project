#!/usr/bin/env bash
# =============================================================================
#  analyze-no-shows.sh — Warum erscheinen gebuchte Bewerber nicht?
# =============================================================================
#  NUR LESEND (ausschliesslich SELECT). Aendert nichts.
#
#  Verwendung (identisch zu check-mail-health.sh):
#    A) bash scripts/analyze-no-shows.sh              # per SSH (backend-server.env)
#    B) bash scripts/analyze-no-shows.sh --local      # direkt auf dem Backend-Server
#    C) TARGET_DB_URL="postgresql://..." bash scripts/analyze-no-shows.sh
#
#  Zeitraum in Tagen ueber DAYS steuerbar:  DAYS=180 bash scripts/analyze-no-shows.sh
# =============================================================================
set -uo pipefail

MODE="${1:-}"
DAYS="${DAYS:-90}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=postgres}"
: "${BACKEND_DB_NAME:=postgres}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

if [ -n "${TARGET_DB_URL:-}" ]; then
  RUNNER="url"
elif [ "$MODE" = "--local" ]; then
  RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then
  RUNNER="ssh"
else
  echo "✗ Keine Verbindung konfiguriert (TARGET_DB_URL, backend-server.env oder --local)." >&2
  exit 1
fi

sql() {
  local q="$1"
  case "$RUNNER" in
    url)    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 -P pager=off -c "$q" 2>&1 ;;
    docker) docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -v ON_ERROR_STOP=0 -P pager=off -c "$q" 2>&1 ;;
    ssh)    ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -v ON_ERROR_STOP=0 -P pager=off -c \"${q//\"/\\\"}\"" 2>&1 ;;
  esac
}

# Basis-CTE: jeder vergangene Termin mit Ergebnis + Kontext.
BASE="WITH t AS (
  SELECT ia.id,
         ia.application_id,
         coalesce(ia.tenant_id, a.tenant_id) AS tenant_id,
         ia.starts_at,
         ia.created_at AS booked_at,
         a.created_at  AS applied_at,
         a.email,
         a.source_slug,
         a.source_landing_id,
         CASE
           WHEN ia.status = 'cancelled' THEN 'abgesagt'
           WHEN ia.status = 'completed'
             OR a.interview_completed_at IS NOT NULL
             OR a.interview_started_at   IS NOT NULL THEN 'erschienen'
           ELSE 'no_show'
         END AS ergebnis,
         extract(epoch FROM (ia.starts_at - ia.created_at))/3600 AS vorlauf_h,
         extract(epoch FROM (ia.created_at - a.created_at))/3600 AS reaktion_h
    FROM public.interview_appointments ia
    JOIN public.applications a ON a.id = ia.application_id
   WHERE a.is_test = false
     AND ia.starts_at < now()
     AND a.created_at > now() - interval '$DAYS days'
)"

echo "=============================================================="
echo " No-Show-Analyse   Zeitraum: letzte $DAYS Tage   Modus: $RUNNER"
echo "=============================================================="

log "1/9  Trichter gesamt"
sql "SELECT count(*) AS bewerbungen,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.interview_appointments x WHERE x.application_id = a.id)) AS mit_termin,
            count(*) FILTER (WHERE a.interview_started_at IS NOT NULL OR a.interview_completed_at IS NOT NULL) AS interview_gestartet
       FROM public.applications a
      WHERE a.is_test = false AND a.created_at > now() - interval '$DAYS days';"

log "2/9  Ergebnis der vergangenen Termine"
sql "$BASE SELECT ergebnis, count(*),
            round(100.0*count(*)/nullif(sum(count(*)) OVER (),0),1) AS anteil_prozent
       FROM t GROUP BY ergebnis ORDER BY 2 DESC;"

log "3/9  No-Show-Quote nach Vorlaufzeit (Buchung -> Termin)"
sql "$BASE SELECT CASE
              WHEN vorlauf_h < 6   THEN '1 unter 6h'
              WHEN vorlauf_h < 24  THEN '2 6-24h'
              WHEN vorlauf_h < 48  THEN '3 1-2 Tage'
              WHEN vorlauf_h < 72  THEN '4 2-3 Tage'
              WHEN vorlauf_h < 168 THEN '5 3-7 Tage'
              ELSE '6 ueber 7 Tage' END AS vorlauf,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t GROUP BY 1 ORDER BY 1;"

log "4/9  No-Show-Quote nach Reaktionszeit (Bewerbung -> Buchung)"
sql "$BASE SELECT CASE
              WHEN reaktion_h < 24  THEN '1 am selben Tag'
              WHEN reaktion_h < 48  THEN '2 nach 1 Tag'
              WHEN reaktion_h < 96  THEN '3 nach 2-3 Tagen'
              WHEN reaktion_h < 168 THEN '4 nach 4-7 Tagen'
              ELSE '5 spaeter' END AS reaktion,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t GROUP BY 1 ORDER BY 1;"

log "5/9  No-Show-Quote nach Uhrzeit (Europe/Berlin)"
sql "$BASE SELECT to_char(starts_at AT TIME ZONE 'Europe/Berlin','HH24') AS stunde,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t GROUP BY 1 HAVING count(*) >= 5 ORDER BY 1;"

log "6/9  No-Show-Quote nach Wochentag"
sql "$BASE SELECT to_char(starts_at AT TIME ZONE 'Europe/Berlin','ID Day') AS wochentag,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t GROUP BY 1 ORDER BY 1;"

log "7/9  No-Show-Quote je Mandant"
sql "$BASE SELECT coalesce(te.name,'unbekannt') AS mandant,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t LEFT JOIN public.tenants te ON te.id = t.tenant_id
      GROUP BY 1 HAVING count(*) >= 5 ORDER BY no_show_prozent DESC NULLS LAST;"

log "8/9  No-Show-Quote je Quelle / Landingpage"
sql "$BASE SELECT coalesce(lp.firmenname, lp.slug, t.source_slug, 'unbekannt') AS quelle,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM t LEFT JOIN public.landing_pages lp ON lp.id = t.source_landing_id
      GROUP BY 1 HAVING count(*) >= 5 ORDER BY no_show_prozent DESC NULLS LAST;"

log "9/9  Wurden Bestaetigung und Erinnerungen ueberhaupt zugestellt?"
sql "$BASE, m AS (
       SELECT t.*,
              EXISTS (SELECT 1 FROM public.email_send_log l
                       WHERE lower(l.recipient_email)=lower(t.email)
                         AND l.template_name='booking_confirmation' AND l.status='sent') AS hat_bestaetigung,
              EXISTS (SELECT 1 FROM public.email_send_log l
                       WHERE lower(l.recipient_email)=lower(t.email)
                         AND l.template_name='interview_reminder_24h' AND l.status='sent') AS hat_24h,
              EXISTS (SELECT 1 FROM public.email_send_log l
                       WHERE lower(l.recipient_email)=lower(t.email)
                         AND l.template_name='interview_invite_30min' AND l.status='sent') AS hat_30min
         FROM t
     )
     SELECT hat_bestaetigung, hat_24h, hat_30min,
            count(*) AS termine,
            count(*) FILTER (WHERE ergebnis='no_show') AS no_shows,
            round(100.0*count(*) FILTER (WHERE ergebnis='no_show')
                  /nullif(count(*) FILTER (WHERE ergebnis<>'abgesagt'),0),1) AS no_show_prozent
       FROM m GROUP BY 1,2,3 ORDER BY termine DESC;"

log "Zusatz  Fehlgeschlagene/uebersprungene Termin-Mails im Zeitraum"
sql "SELECT template_name, status, count(*)
       FROM public.email_send_log
      WHERE created_at > now() - interval '$DAYS days'
        AND template_name IN ('booking_confirmation','interview_reminder_24h','interview_invite_30min','no_show_24h')
      GROUP BY 1,2 ORDER BY 1,3 DESC;"

echo
echo "Fertig. Hohe No-Show-Quoten bei einzelnen Quellen/Uhrzeiten/Vorlaufzeiten"
echo "zeigen, wo Traffic bzw. Terminlogik angepasst werden sollte."