#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — Update-Deploy auf Portal-Server (Server 2)
# =============================================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
ENV_FILE="$PROJECT_DIR/.env.server"
[ -f "$ENV_FILE" ] || ENV_FILE="$PROJECT_DIR/.env"

REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/DianaKnodel1/integrate-project.git}"
SERVICE_NAME="${SERVICE_NAME:-portal.service}"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
RELEASES_DIR="${RELEASES_DIR:-$PROJECT_DIR/.releases}"
ACTIVE_RELEASE_LINK="${ACTIVE_RELEASE_LINK:-$PROJECT_DIR/current}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

env_file_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'
}

validate_config() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "  ✗ $ENV_FILE fehlt." >&2
    exit 1
  fi
  # Export for build
  export VITE_SUPABASE_URL="$(env_file_value VITE_SUPABASE_URL)"
  export VITE_SUPABASE_PUBLISHABLE_KEY="$(env_file_value VITE_SUPABASE_PUBLISHABLE_KEY)"
  export SUPABASE_URL="$(env_file_value SUPABASE_URL)"
  export SUPABASE_PUBLISHABLE_KEY="$(env_file_value SUPABASE_PUBLISHABLE_KEY)"
}

cd "$PROJECT_DIR"
{
  log "1/5  git pull"
  git fetch --all
  git reset --hard "origin/$REPO_BRANCH"

  log "2/5  build"
  bun install --frozen-lockfile
  # Fix for Bun SIGABRT/Memory issues: use Node for build if available, or try to limit Bun memory
  if command -v node >/dev/null 2>&1; then
    log "  (Using Node.js for build to avoid SIGABRT)"
    # Ensure dependencies are available for Node
    NODE_OPTIONS="--max-old-space-size=4096" npm run build || bun run build
  else
    # Fallback to Bun with limited parallel tasks if possible, but Bun doesn't have a direct equivalent to --max-old-space-size
    bun run build
  fi

  log "3/5  release activation"
  release_dir="$RELEASES_DIR/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$release_dir"
  cp -a "$PROJECT_DIR/.output" "$release_dir/.output"
  ln -sfn "$release_dir" "$ACTIVE_RELEASE_LINK"
  
  log "4/5  migrations"
  TARGET_DB_URL="$(env_file_value TARGET_DB_URL)"
  if [ -n "$TARGET_DB_URL" ]; then
    log "4/5  Manual-Migrations prüfen"
    # Extract host from URL if possible, otherwise use fallback
    DB_HOST=$(echo "$TARGET_DB_URL" | grep -oP '(?<=@)[^:/]+' || echo "190.97.167.123")
    
    echo "  (Preflight: Teste Verbindung zu $DB_HOST ...)"
    if psql "$TARGET_DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
      MIG_DIR="$PROJECT_DIR/supabase/manual-migrations"
      STATE_FILE="$PROJECT_DIR/.deploy-migrations-applied"
      touch "$STATE_FILE"
      for sql in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
        name="$(basename "$sql")"
        if ! grep -qxF "$name" "$STATE_FILE"; then
          echo "  · Applying $name..."
          if psql "$TARGET_DB_URL" -f "$sql"; then
            echo "$name" >> "$STATE_FILE"
            ok "$name applied"
          else
            warn "Fehler beim Anwenden von $name"
          fi
        fi
      done
    else
      warn "TARGET_DB_URL nicht erreichbar!"
      echo "    1. Prüfe Passwort in $ENV_FILE"
      echo "    2. Prüfe ob DB-Server ($DB_HOST) erreichbar ist (ping / telnet)"
      echo "    3. Migrations-Schritt wird übersprungen."
    fi
  fi

  log "5/5  restart"
  systemctl restart "$SERVICE_NAME"
  ok "Deploy finished ✅"
}
