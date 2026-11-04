#!/bin/bash
# Saves Overlap's settings on your Netlify site, then deploys it.
# Run it from the project folder once it's linked to a Netlify site (`netlify init` or `netlify link`).
# Settings that are already saved are left alone, so it's safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v netlify >/dev/null || { echo "Install the Netlify CLI first: npm install -g netlify-cli"; exit 1; }
netlify status >/dev/null 2>&1 || { echo "Link this folder to a Netlify site first: netlify init"; exit 1; }

has() {
  netlify env:get "$1" --context production --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const v = Object.values(JSON.parse(s))[0]; process.exit(v ? 0 : 1); } catch { process.exit(1); }
    });'
}

ask() { # name, question, "secret" to hide typing
  if has "$1"; then echo "✓ $1 is already set"; return; fi
  local value
  if [ "${3:-}" = secret ]; then read -rsp "$2: " value; echo; else read -rp "$2: " value; fi
  [ -n "$value" ] || { echo "Skipped $1"; return; }
  netlify env:set "$1" "$value" >/dev/null && echo "✓ Saved $1"
}

ask GOOGLE_CLIENT_ID "Google client ID (ends in .apps.googleusercontent.com)"
ask GOOGLE_CLIENT_SECRET "Google client secret (hidden as you type)" secret
ask ADMIN_EMAILS "Email address(es) allowed to make booking pages, comma-separated"
if has APP_SECRET; then echo "✓ APP_SECRET is already set"; else
  netlify env:set APP_SECRET "$(openssl rand -hex 32)" >/dev/null && echo "✓ Made a random APP_SECRET"
fi

echo "Deploying…"
netlify deploy --build --prod
