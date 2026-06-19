#!/usr/bin/env bash
# Health check: build status + what's up. Read-only — changes nothing.
#   build-doctor.sh            one-shot (used by post-start.sh on container start)
#   build-doctor.sh --watch    live panel: auto-refresh ~2s, any key = refresh now, q = quit
set -uo pipefail
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"

# Color only when writing to a terminal (post-start runs this against a non-TTY log).
if [ -t 1 ]; then
  G=$'\e[32m'; Y=$'\e[33m'; DIM=$'\e[2m'; BOLD=$'\e[1m'; RST=$'\e[0m'
else
  G=; Y=; DIM=; BOLD=; RST=
fi
RULE="══════════════════════════════════════════════"
THIN="──────────────────────────────────────────────"

sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }
tcp() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }
human_dur() { # seconds -> compact "3d 4h" / "2h 5m" / "12m" / "9s"
  local s=$1
  if   [ "$s" -ge 86400 ]; then echo "$((s / 86400))d $(((s % 86400) / 3600))h"
  elif [ "$s" -ge 3600 ];  then echo "$((s / 3600))h $(((s % 3600) / 60))m"
  elif [ "$s" -ge 60 ];    then echo "$((s / 60))m"
  else echo "${s}s"; fi
}

actions=()
opt_running=0
svc() { # svc <label> <tool> <port> <up:0/1>
  if [ "$4" -eq 0 ]; then
    printf '  %s✓%s %-10s%s%-12s%s%s\n' "$G" "$RST" "$1" "$DIM" "$2" "$3" "$RST"
  else
    printf '  %s⚠%s %-10s%s%-12s%s %sDOWN%s\n' "$Y" "$RST" "$1" "$DIM" "$2" "$3" "$Y" "$RST"
    actions+=("$1 service is down ($2 $3).")
  fi
}
opt() { # opt <label> <port> <running:0/1> [url]
  if [ "$3" -eq 0 ]; then
    printf '  %s●%s %-18s%-7s %srunning%s\n' "$G" "$RST" "$1" "$2" "$G" "$RST"
    [ -n "${4:-}" ] && printf '       %s%s%s\n' "$DIM" "$4" "$RST"
    opt_running=$((opt_running + 1))
  else
    printf '  %s○%s %-18s%-7s %sstopped%s\n' "$DIM" "$RST" "$1" "$2" "$DIM" "$RST"
  fi
}

render() {
  actions=(); opt_running=0
  local now last_build up_secs up_str build_ok
  now=$(date +%s)
  if [ -f "$STATE/complete" ]; then
    last_build="$(human_dur $(( now - $(stat -c %Y "$STATE/complete" 2>/dev/null || echo "$now") ))) ago"
  else
    last_build="never"
  fi
  up_secs=$(ps -o etimes= -p 1 2>/dev/null | tr -dc '0-9')
  up_str=$([ -n "$up_secs" ] && human_dur "$up_secs" || echo "?")

  printf '%s\n %s🩺  Positron CI Doctor%s\n%s\n\n' "$RULE" "$BOLD" "$RST" "$RULE"

  # Build
  build_ok=1
  [ -f "$STATE/complete" ] || { build_ok=0; actions+=("Cold build never completed → run 'Full rebuild (post-create)'."); }
  [ -d "$WS/out" ]        || { build_ok=0; actions+=("No compiled output (out/) → start the watcher ('npm run watch') or run 'Full rebuild (post-create)'."); }
  [ -e "$WS/.build/electron" ] || { build_ok=0; actions+=("Electron not set up → run 'Full rebuild (post-create)'."); }
  [ "$(sha "$WS/package-lock.json")" = "$(cat "$STATE/deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("Root deps changed → run 'Reinstall deps (npm ci)'."); }
  [ "$(sha "$WS/test/e2e/package-lock.json")" = "$(cat "$STATE/e2e-deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("test/e2e deps changed → run 'Full rebuild (post-create)'."); }

  if [ "$build_ok" -eq 1 ]; then
    printf '%s✓%s %sBuild%s      current — incremental watch is all you need\n' "$G" "$RST" "$BOLD" "$RST"
  else
    printf '%s⚠%s %sBuild%s      needs attention (see below)\n' "$Y" "$RST" "$BOLD" "$RST"
  fi
  printf '             %slast full build %s · container up %s%s\n\n' "$DIM" "$last_build" "$up_str" "$RST"

  # Core services
  printf '%sCore services%s\n' "$BOLD" "$RST"
  pgrep -x Xvfb >/dev/null 2>&1; svc "Display"  "Xvfb"        ":10"   "$?"
  tcp 127.0.0.1 5900;            svc "VNC"       "x11vnc"      ":5900" "$?"
  tcp 127.0.0.1 6080;            svc "noVNC"     "websockify"  ":6080" "$?"
  tcp postgres 5432;             svc "Postgres"  "postgres"    ":5432" "$?"
  echo

  # On demand
  printf '%sOn demand%s\n' "$BOLD" "$RST"
  tcp 127.0.0.1 8080; opt "Positron server" ":8080" "$?" "http://localhost:8080/?tkn=dev-token"
  pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1
  opt "Desktop app" "(VNC)" "$?" "http://localhost:6080/vnc.html?autoconnect=true&password=positron"
  tcp 127.0.0.1 9323; opt "Playwright report" ":9323" "$?" "http://localhost:9323"
  [ "$opt_running" -gt 0 ] && printf '  %s↳ stop these with the "Positron CI: Stop services" task%s\n' "$DIM" "$RST"
  echo

  # Footer
  printf '%s\n' "$THIN"
  if [ "${#actions[@]}" -eq 0 ]; then
    printf ' %s✓ Ready for development.%s\n' "$G" "$RST"
  else
    printf ' %s⚠ %d item(s) need attention:%s\n' "$Y" "${#actions[@]}" "$RST"
    for a in "${actions[@]}"; do printf '   • %s\n' "$a"; done
  fi
  printf '%s\n' "$RULE"
}

if [ "${1:-}" = "--watch" ]; then
  # Live panel only makes sense interactively; without a TTY just render once.
  if [ ! -t 0 ] || [ ! -t 1 ]; then render; exit 0; fi
  trap 'printf "\e[?25h\n"; exit 0' INT TERM
  printf '\e[?25l'  # hide cursor to cut flicker
  while true; do
    printf '\e[H\e[2J'  # home + clear
    render
    printf '\n%s(auto-refresh 2s · any key = refresh · q = quit)%s\n' "$DIM" "$RST"
    if read -rsn1 -t 2 key; then
      [ "$key" = "q" ] && break
    fi
  done
  printf '\e[?25h'  # restore cursor
  exit 0
fi

render
exit 0
