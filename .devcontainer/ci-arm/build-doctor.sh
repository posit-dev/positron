#!/usr/bin/env bash
# Health check: build status + what's up. Read-only — changes nothing.
#   build-doctor.sh            one-shot (used by post-start.sh on container start)
#   build-doctor.sh --watch    live panel: redraws when state changes, any key = refresh, q = quit
set -uo pipefail
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"
QA_TMP="${TMPDIR:-/tmp}"; QA_TMP="${QA_TMP%/}"
QA_DEST="${POSITRON_TEST_DATA_PATH:-$QA_TMP/vscsmoke}/qa-example-content"  # what the e2e tests open

# Color only when writing to a terminal (post-start runs this against a non-TTY log). Named ANSI
# attributes so it stays readable in both dark and light themes.
if [ -t 1 ]; then
  G=$'\e[32m'; Y=$'\e[33m'; DIM=$'\e[2m'; BOLD=$'\e[1m'; RST=$'\e[0m'
else
  G=; Y=; DIM=; BOLD=; RST=
fi
DIV="────────────────────────────────────────────"

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

# A heading + its rows form a "card". Rows share one left edge (text starts at column 4) across all
# sections. Names lead; tool/port/detail are dimmed so the eye scans the glyph + name first.

# Core service row: csvc <name> <tool> <port> <up:0/1>.  ✓ = up, ⚠ = down.
csvc() {
  if [ "$4" -eq 0 ]; then
    printf '  %s✓%s %-10s%s%-12s%s%s\n' "$G" "$RST" "$1" "$DIM" "$2" "$3" "$RST"
  else
    printf '  %s⚠%s %-10s%s%-12s%s%s\n' "$Y" "$RST" "$1" "$DIM" "$2" "$3" "$RST"
    actions+=("$1 is down ($2 $3).")
  fi
}

# On-demand row: odsvc <name> <port|VNC> <running:0/1> [url].  ● green + running / ○ dim + stopped.
odsvc() {
  if [ "$3" -eq 0 ]; then
    printf '  %s●%s %-19s%s%-7s%s %srunning%s\n' "$G" "$RST" "$1" "$DIM" "$2" "$RST" "$G" "$RST"
    [ -n "${4:-}" ] && printf '    %s↳ %s%s\n' "$DIM" "$4" "$RST"
    opt_running=$((opt_running + 1))
  else
    printf '  %s○ %-19s%-7s stopped%s\n' "$DIM" "$1" "$2" "$RST"
  fi
}

render() {
  actions=(); opt_running=0
  local now last_build up_secs up_str build_ok qa_age

  now=$(date +%s)
  if [ -f "$STATE/complete" ]; then
    last_build="$(human_dur $(( now - $(stat -c %Y "$STATE/complete" 2>/dev/null || echo "$now") ))) ago"
  else
    last_build="never"
  fi
  up_secs=$(ps -o etimes= -p 1 2>/dev/null | tr -dc '0-9')
  up_str=$([ -n "$up_secs" ] && human_dur "$up_secs" || echo "?")

  printf '%sPositron CI Doctor%s\n\n' "$BOLD" "$RST"

  # --- Build ---
  build_ok=1
  [ -f "$STATE/complete" ] || { build_ok=0; actions+=("Cold build never completed → run 'Positron CI: Rebuild'."); }
  [ -d "$WS/out" ]        || { build_ok=0; actions+=("No compiled output (out/) → start the watcher ('npm run watch') or run 'Positron CI: Rebuild'."); }
  [ -e "$WS/.build/electron" ] || { build_ok=0; actions+=("Electron not set up → run 'Positron CI: Rebuild'."); }
  [ "$(sha "$WS/package-lock.json")" = "$(cat "$STATE/deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("Root deps changed → run 'Positron CI: Reinstall deps'."); }
  [ "$(sha "$WS/test/e2e/package-lock.json")" = "$(cat "$STATE/e2e-deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("test/e2e deps changed → run 'Positron CI: Rebuild'."); }

  printf '%sBuild%s\n' "$BOLD" "$RST"
  if [ "$build_ok" -eq 1 ]; then
    printf '  %s✓%s Up to date\n' "$G" "$RST"
  else
    printf '  %s⚠%s Needs attention\n' "$Y" "$RST"
  fi
  printf '    %s%-12s%s%s\n' "$DIM" "Built" "$last_build" "$RST"
  printf '    %s%-12s%s%s\n' "$DIM" "Uptime" "$up_str" "$RST"
  if [ -d "$QA_DEST" ]; then
    qa_age="$(human_dur $(( now - $(stat -c %Y "$QA_DEST" 2>/dev/null || echo "$now") )))"
    printf '    %s%-12spresent · updated %s ago%s\n' "$DIM" "QA content" "$qa_age" "$RST"
    printf '    %s%-12s%s%s\n' "$DIM" "" "$QA_DEST" "$RST"
  else
    printf '    %s%-12snot fetched — run "Positron CI: Get QA content"%s\n' "$DIM" "QA content" "$RST"
  fi
  printf '\n'

  # --- Core Services ---
  printf '%sCore Services%s\n' "$BOLD" "$RST"
  pgrep -x Xvfb >/dev/null 2>&1; csvc "Display"  "Xvfb"        ":10"   "$?"
  tcp 127.0.0.1 5900;            csvc "VNC"       "x11vnc"      ":5900" "$?"
  tcp 127.0.0.1 6080;            csvc "noVNC"     "websockify"  ":6080" "$?"
  tcp postgres 5432;             csvc "Postgres"  "postgres"    ":5432" "$?"
  printf '\n'

  # --- On-Demand Services ---
  printf '%sOn-Demand Services%s\n' "$BOLD" "$RST"
  tcp 127.0.0.1 8080; odsvc "Positron server" ":8080" "$?" "http://localhost:8080/?tkn=dev-token"
  pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1
  odsvc "Desktop app" "VNC" "$?" "http://localhost:6080/vnc.html?autoconnect=true&password=positron"
  tcp 127.0.0.1 9323; odsvc "Playwright report" ":9323" "$?" "http://localhost:9323"
  printf '\n'

  # --- Footer ---
  printf '%s%s%s\n\n' "$DIM" "$DIV" "$RST"
  if [ "${#actions[@]}" -eq 0 ]; then
    printf '%s✓ Ready for development%s\n' "$G" "$RST"
  else
    printf '%s⚠ %d item(s) need attention%s\n' "$Y" "${#actions[@]}" "$RST"
    for a in "${actions[@]}"; do printf '  %s• %s%s\n' "$DIM" "$a" "$RST"; done
  fi
}

# Compact runtime signature (services + on-demand + qa). --watch redraws when it changes.
sig() {
  local s=""
  pgrep -x Xvfb >/dev/null 2>&1 && s+=X || s+=x
  tcp 127.0.0.1 5900 && s+=V || s+=v
  tcp 127.0.0.1 6080 && s+=N || s+=n
  tcp postgres 5432  && s+=P || s+=p
  tcp 127.0.0.1 8080 && s+=S || s+=s
  pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1 && s+=D || s+=d
  tcp 127.0.0.1 9323 && s+=R || s+=r
  [ -d "$QA_DEST" ] && s+=Q || s+=q
  printf '%s' "$s"
}

if [ "${1:-}" = "--watch" ]; then
  # Live panel only makes sense interactively; without a TTY just render once.
  if [ ! -t 0 ] || [ ! -t 1 ]; then render; exit 0; fi
  POLL=3         # how often to check for changes (seconds)
  HEARTBEAT=300  # force a redraw at least this often, to refresh the timestamps
  trap 'printf "\e[?25h\n"; exit 0' INT TERM
  printf '\e[?25l'  # hide cursor to cut flicker
  last_sig="__init__"; last_draw=0
  while true; do
    cur_sig="$(sig)"; nowt=$(date +%s)
    if [ "$cur_sig" != "$last_sig" ] || [ $((nowt - last_draw)) -ge "$HEARTBEAT" ]; then
      printf '\e[H\e[2J'  # home + clear
      render
      printf '\n%s(auto-updates • any key refresh • q quit)%s\n' "$DIM" "$RST"
      last_sig="$cur_sig"; last_draw="$nowt"
    fi
    if read -rsn1 -t "$POLL" key; then
      [ "$key" = "q" ] && break
      last_sig="__force__"  # any key → redraw next tick
    fi
  done
  printf '\e[?25h'  # restore cursor
  exit 0
fi

render
exit 0
