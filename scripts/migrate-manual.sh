#!/bin/bash
# Script zum manuellen Einspielen der Tabellen auf dem Backend (.123)

# 1. Container-Name auf .123 ermitteln
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "Fehler: Kein Datenbank-Container gefunden!"
  exit 1
fi

echo "Verwende Container: $CONTAINER"

# 2. Migrations nacheinander einspielen
# Da die Dateien auf .124 liegen, müssen sie einzeln via Docker exec übertragen werden
# (Wenn dieses Script direkt auf .123 ausgeführt wird und das Projekt dort unter /opt/apps/portal liegt)

cd /opt/apps/portal

for sql in $(ls supabase/manual-migrations/*.sql | sort); do
  echo "Wende an: $sql ..."
  cat "$sql" | docker exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin
done

echo "Fertig! Datenbank auf .123 ist nun aktuell. ✅"
