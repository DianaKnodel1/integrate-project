#!/usr/bin/env bash
set -euo pipefail
BACKEND_IP="190.97.167.123"
BACKEND_USER="root"
PROJECT_DIR="/opt/apps/portal"
log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
cd "$PROJECT_DIR"
log "1/4 Lokal auf .124: Git Pull & Build"
git fetch --all && git reset --hard origin/main
bun install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=4096" bun run build
log "2/4 Synchronisierung nach .123"
ssh "$BACKEND_USER@$BACKEND_IP" "mkdir -p '$PROJECT_DIR/.output' '$PROJECT_DIR/supabase' '$PROJECT_DIR/scripts'"
rsync -avz --delete .output/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/.output/"
rsync -avz supabase/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/supabase/"
rsync -avz scripts/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/scripts/"
log "3/4 Datenbank-Migrationen"
bash scripts/sync-to-backend.sh
log "4/4 Neustart"
ssh "$BACKEND_USER@$BACKEND_IP" "systemctl restart portal.service 2>/dev/null || echo 'Kein Dienst auf .123'"
ok "Full-Stack Deployment abgeschlossen! ✅"
