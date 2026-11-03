#!/usr/bin/env bash
# Install (or update) Deck Forge in Kiro Crew. Run from anywhere: pnpm app:install
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$APP_DIR/dist/deck-forge"
BASE="${KIROCREW_URL:-http://127.0.0.1:5476}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

[ -f "$SRC/app.json" ] || { echo "Nothing to install yet. Run: pnpm build"; exit 1; }
command -v kirocrew >/dev/null || { echo "kirocrew is not installed or not on PATH."; exit 1; }

# Sign in to the local gateway (sets a cookie).
TOK="$(kirocrew token 2>/dev/null | tail -1 | sed 's/.*token=//')"
[ -n "$TOK" ] || { echo "Could not get a gateway token. Is the gateway running? Start it with: kirocrew gateway"; exit 1; }
curl -s -c "$JAR" -o /dev/null "$BASE/?token=$TOK" || { echo "Gateway not reachable at $BASE. Start it with: kirocrew gateway"; exit 1; }

# Trust Deck Forge, keeping any apps you already trust.
python3 - <<'PY'
import json, subprocess
raw = subprocess.run(["kirocrew", "config", "get", "agent.apps_trusted"], capture_output=True, text=True).stdout
try:
    trusted = json.loads(raw)
    if not isinstance(trusted, list):
        trusted = []
except ValueError:
    trusted = []
if "deck-forge" not in trusted:
    trusted.append("deck-forge")
    subprocess.run(["kirocrew", "config", "set", "agent.apps_trusted", json.dumps(trusted)], check=True)
PY

# Install the first time, update afterwards.
CODE="$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/apps/deck-forge")"
ACTION=install; [ "$CODE" = "200" ] && ACTION=update
if [ "$ACTION" = install ]; then URL="$BASE/api/apps/install"; else URL="$BASE/api/apps/deck-forge/update"; fi
curl -s -b "$JAR" -X POST "$URL" -H 'Content-Type: application/json' -d "{\"source\":\"$SRC\"}"; echo
curl -s -b "$JAR" -X POST "$BASE/api/apps/deck-forge/enable" >/dev/null

echo
echo "Done. Open Kiro Crew: $BASE/?token=$TOK"
echo "Then click Deck Forge in the sidebar."
