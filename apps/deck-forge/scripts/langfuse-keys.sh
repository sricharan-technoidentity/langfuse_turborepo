#!/usr/bin/env bash
# Save your Langfuse keys for the installed app. Run: pnpm app:keys
# The keys are typed hidden and written to a private file outside the repo.
set -euo pipefail

DIR="$HOME/.kiro/crew/apps/deck-forge/data"
FILE="$DIR/langfuse.env"
mkdir -p "$DIR"

read -r -p "Langfuse public key (pk-lf-...): " PUB
read -r -s -p "Langfuse secret key (sk-lf-...): " SEC; echo
read -r -p "Langfuse URL [https://us.cloud.langfuse.com]: " URL
URL="${URL:-https://us.cloud.langfuse.com}"

umask 077
printf 'LANGFUSE_PUBLIC_KEY=%s\nLANGFUSE_SECRET_KEY=%s\nLANGFUSE_BASE_URL=%s\n' "$PUB" "$SEC" "$URL" > "$FILE"
chmod 600 "$FILE"
echo "Saved to $FILE"
echo "Now run: pnpm app:install   (restarts the app so it picks the keys up)"
