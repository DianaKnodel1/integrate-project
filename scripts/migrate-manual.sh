#!/bin/bash
# Script zum manuellen Einspielen der Tabellen auf dem Backend (.123)

# 1. Projekt-Verzeichnis finden
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT" || { echo "Fehler: Projekt-Verzeichnis nicht gefunden!"; exit 1; }

echo "Projekt-Verzeichnis: $PROJECT_ROOT"

# 2. Container-Name auf .123 ermitteln
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "Fehler: Kein Datenbank-Container gefunden!"
  echo "Stellen Sie sicher, dass Docker auf diesem Server installiert ist und der DB-Container läuft."
  exit 1
fi

echo "Verwende Container: $CONTAINER"

# 3. Migrations nacheinander einspielen
if [ ! -d "supabase/manual-migrations" ]; then
  echo "Fehler: Verzeichnis supabase/manual-migrations nicht gefunden!"
  exit 1
fi

for sql in $(ls supabase/manual-migrations/*.sql | sort); do
  echo "Wende an: $sql ..."
  if ! cat "$sql" | docker exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin; then
    echo "Fehler beim Anwenden von $sql"
    exit 1
  fi
done

echo "Fertig! Datenbank auf .123 ist nun aktuell. ✅"
