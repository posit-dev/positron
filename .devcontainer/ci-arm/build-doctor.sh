#!/usr/bin/env bash
# Health check: build status + what's up. Read-only — changes nothing.
#   build-doctor.sh            one-shot (used by post-start.sh on container start)
#   build-doctor.sh --watch    live panel: redraws when state changes, any key = refresh, q = quit
set -uo pipefail
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"
QA_TMP="${TMPDIR:-/tmp}"; QA_TMP="${QA_TMP%/}"
QA_DEST="${POSITRON_TEST_DATA_PATH:-$QA_TMP/vscsmoke}/qa-example-content"  # what the e2e tests open

# In-tree native binaries (pet/ark/kcserver). Bind-mounted and shared with the host, so a native
# macOS build leaves Mach-O binaries here that can't exec in the container - silently breaking
# Python/R startup. The Interpreters row flags a wrong-OS binary. See check-native-arch.sh / README.
PET_BIN="$WS/extensions/positron-python/python-env-tools/pet"
ARK_BIN="$WS/extensions/positron-r/resources/ark/ark"
KC_BIN="$WS/extensions/positron-supervisor/resources/kallichore/kcserver"

# Color only when writing to a terminal (post-start runs this against a non-TTY log). Named ANSI
# attributes so it stays readable in both dark and light themes.
if [ -t 1 ]; then
  G=$'\e[32m'; Y=$'\e[33m'; RED=$'\e[31m'; DIM=$'\e[2m'; BOLD=$'\e[1m'; RST=$'\e[0m'
else
  G=; Y=; RED=; DIM=; BOLD=; RST=
fi
SERVER_ERR=/tmp/positron-server.err     # written by start-server.sh on a failed start
DESKTOP_ERR=/tmp/positron-electron.err  # written by launch-electron.sh on a failed launch

sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }
tcp() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }
human_dur() { # seconds -> compact "3d 4h" / "2h 5m" / "12m" / "9s"
  local s=$1
  if   [ "$s" -ge 86400 ]; then echo "$((s / 86400))d $(((s % 86400) / 3600))h"
  elif [ "$s" -ge 3600 ];  then echo "$((s / 3600))h $(((s % 3600) / 60))m"
  elif [ "$s" -ge 60 ];    then echo "$((s / 60))m"
  else echo "${s}s"; fi
}

# Wrong-OS guard: detect ELF by its 4-byte magic with od (the CI image ships no `file`; a missing
# `file` would false-flag every binary). wrong_os_bins prints the space-joined names of any
# present-but-non-ELF binaries - empty when all good.
is_elf() { # <path> -> 0 if absent or Linux ELF, 1 if present but not ELF
  [ -e "$1" ] || return 0
  [ "$(od -An -tx1 -N4 "$1" 2>/dev/null | tr -d ' \n')" = "7f454c46" ]
}
wrong_os_bins() {
  local bad=""
  is_elf "$PET_BIN" || bad+="pet "
  is_elf "$ARK_BIN" || bad+="ark "
  is_elf "$KC_BIN"  || bad+="kcserver "
  printf '%s' "${bad% }"
}

actions=()
opt_running=0

# A heading + its rows form a "card". Rows share one left edge (text starts at column 4) across all
# sections. Names lead; tool/port/detail are dimmed so the eye scans the glyph + name first.

# Build + Core Services share one name column (NAMEW) so their value columns line up. On-Demand
# uses its own wider column (ODNAMEW) because its names are descriptive ("Desktop (Electron)").
NAMEW=14    # longest name is "Display/VNC" (11); keep a few spaces before the value column
ODNAMEW=20  # longest name is "Desktop (Electron)" (18); leave a 2-space gap before the value

# Core service row: csvc <name> <tool> <port> <up:0/1> <fix>.  ✓ = up, ⚠ = down (footer shows fix).
csvc() {
  if [ "$4" -eq 0 ]; then
    printf '  %s✓%s %-*s%s%-12s%s%s\n' "$G" "$RST" "$NAMEW" "$1" "$DIM" "$2" "$3" "$RST"
  else
    printf '  %s⚠%s %-*s%s%-12s%s%s\n' "$Y" "$RST" "$NAMEW" "$1" "$DIM" "$2" "$3" "$RST"
    actions+=("$1 ($2 $3) is down → $5")
  fi
}

# On-demand row: odsvc <name> <port|VNC> <running:0/1> <errfile> [url].
# allow-any-unicode-next-line
#   running = green ● + URL inline;  failed-to-start (errfile exists) = red ✗ + reason;  else dim ○.
odsvc() {
  if [ "$3" -eq 0 ]; then
    printf '  %s●%s %-*s%s%-7s %s%s\n' "$G" "$RST" "$ODNAMEW" "$1" "$DIM" "$2" "${5:-}" "$RST"
    opt_running=$((opt_running + 1))
  elif [ -n "${4:-}" ] && [ -f "$4" ]; then
    local why; why="$(head -1 "$4" 2>/dev/null)"
    # allow-any-unicode-next-line
    printf '  %s✗%s %-*s%sfailed: %s%s\n' "$RED" "$RST" "$ODNAMEW" "$1" "$RED" "$why" "$RST"
    actions+=("$1 failed to start: $why")
  else
    # allow-any-unicode-next-line
    printf '  %s○ %-*s%s%s\n' "$DIM" "$ODNAMEW" "$1" "$2" "$RST"
  fi
}

render() {
  actions=(); opt_running=0
  local now last_build up_secs up_str build_ok qa_age novnc_up
  # Build-running state: --watch passes it in (derived from sig's B bit) so we don't re-probe the
  # process table every frame; standalone (one-shot) calls leave it empty and compute it here.
  local building="${1:-}"
  [ -z "$building" ] && { pgrep -f "ci-arm/post-create.sh" >/dev/null 2>&1 && building=1 || building=0; }

  now=$(date +%s)
  if [ -f "$STATE/complete" ]; then
    last_build="$(human_dur $(( now - $(stat -c %Y "$STATE/complete" 2>/dev/null || echo "$now") ))) ago"
  else
    last_build="never"
  fi
  up_secs=$(ps -o etimes= -p 1 2>/dev/null | tr -dc '0-9')
  up_str=$([ -n "$up_secs" ] && human_dur "$up_secs" || echo "?")

  printf '%sPositron CI Doctor%s\n' "$BOLD" "$RST"
  printf '%s------------------%s\n\n' "$DIM" "$RST"

  # --- Environment ---
  # One umbrella over what's provisioned: Build, Container, Interpreters, and QA fixture data.
  # Healthy/normal reads as a check across the board, so the eye only catches the exceptions: a
  # warning when something needs attention (Build out of date, Interpreters wrong-OS), the spinner
  # while a build runs, and a dim circle for the optional QA content when it isn't fetched (neutral -
  # absence isn't an error, never in the footer). Container is always healthy (we run inside it).
  # The footer lists the "why" for any warning.
  printf '%sEnvironment%s\n' "$BOLD" "$RST"

  if [ "$building" = 1 ]; then
    # A cold build / Rebuild is actively running — show that instead of nagging to rebuild.
    # allow-any-unicode-next-line
    printf '  %s⟳%s %-*s%sbuilding… (watch the build terminal)%s\n' "$Y" "$RST" "$NAMEW" "Build" "$DIM" "$RST"
  else
    build_ok=1
    [ -f "$STATE/complete" ] || { build_ok=0; actions+=("Cold build never completed → run 'Positron CI: Rebuild'."); }
    [ -d "$WS/out" ]        || { build_ok=0; actions+=("No compiled output (out/) → start the watcher ('npm run watch') or run 'Positron CI: Rebuild'."); }
    [ -e "$WS/.build/electron" ] || { build_ok=0; actions+=("Electron not set up → run 'Positron CI: Rebuild'."); }
    [ "$(sha "$WS/package-lock.json")" = "$(cat "$STATE/deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("Root deps changed → run 'Positron CI: Reinstall deps'."); }
    [ "$(sha "$WS/test/e2e/package-lock.json")" = "$(cat "$STATE/e2e-deps.sha" 2>/dev/null)" ] || { build_ok=0; actions+=("test/e2e deps changed → run 'Positron CI: Reinstall e2e deps'."); }
    if [ "$build_ok" -eq 1 ]; then
      printf '  %s✓%s %-*s%scurrent · %s%s\n' "$G" "$RST" "$NAMEW" "Build" "$DIM" "$last_build" "$RST"
    else
      printf '  %s⚠%s %-*s%sneeds attention%s\n' "$Y" "$RST" "$NAMEW" "Build" "$DIM" "$RST"
    fi
  fi

  # Container — always up (we're inside it), so it always reads ✓; this is just its uptime.
  printf '  %s✓%s %-*s%sup %s%s\n' "$G" "$RST" "$NAMEW" "Container" "$DIM" "$up_str" "$RST"

  # Interpreters — the in-tree pet/ark/kcserver must be Linux ELF; a macOS binary here (checkout
  # also built natively on the host) silently breaks Python/R startup, so it carries health glyphs
  # like Build. The footer names the fix.
  local wrong_bins; wrong_bins="$(wrong_os_bins)"
  if [ -z "$wrong_bins" ]; then
    printf '  %s✓%s %-*s%sok%s\n' "$G" "$RST" "$NAMEW" "Interpreters" "$DIM" "$RST"
  else
    printf '  %s⚠%s %-*s%swrong-OS: %s%s\n' "$Y" "$RST" "$NAMEW" "Interpreters" "$DIM" "$wrong_bins" "$RST"
    actions+=("Wrong-OS interpreter binaries ($wrong_bins) → built natively on the host? Run 'Positron CI: Reinstall interpreters'.")
  fi

  # QA content — optional fixture data the e2e tests open. Fetched reads ✓; when absent it's a dim
  # circle (neutral, not an error - so it never lands in the footer). Path from the 'Get QA content' task.
  if [ -d "$QA_DEST" ]; then
    qa_age="$(human_dur $(( now - $(stat -c %Y "$QA_DEST" 2>/dev/null || echo "$now") )))"
    printf '  %s✓%s %-*s%sfetched %s ago%s\n' "$G" "$RST" "$NAMEW" "QA content" "$DIM" "$qa_age" "$RST"
  else
    # allow-any-unicode-next-line
    printf '  %s○ %-*snot present — run "Positron CI: Get QA content"%s\n' "$DIM" "$NAMEW" "QA content" "$RST"
  fi
  printf '\n'

  # --- Core Services ---
  printf '%sCore Services%s\n' "$BOLD" "$RST"
  local vncfix="run the 'Positron CI: VNC' task to restart the display + VNC stack"
  # Xvnc is one process serving both the headless display (:10) and the VNC port (:5900), so it's
  # one row — green only when the process is up AND :5900 is accepting connections.
  local xvnc_up; if pgrep -x Xvnc >/dev/null 2>&1 && tcp 127.0.0.1 5900; then xvnc_up=0; else xvnc_up=1; fi
  csvc "Display/VNC" "Xvnc" ":10 + :5900" "$xvnc_up" "$vncfix"
  tcp 127.0.0.1 6080; novnc_up=$?; csvc "noVNC"   "websockify"  ":6080" "$novnc_up" "$vncfix"
  tcp postgres 5432;             csvc "Postgres"  "postgres"    ":5432" "$?" "the postgres container isn't running - Dev Containers: Rebuild Container"
  printf '\n'

  # --- Live View ---
  # noVNC is the browser window into the headless display, so show its URL whenever noVNC is up:
  # you can watch the desktop OR any headed e2e test (e2e-electron/e2e-chromium) without launching
  # anything first. (When noVNC is down, Core Services above flags it with the fix.)
  if [ "$novnc_up" -eq 0 ]; then
    printf '%sLive View%s %s(desktop or headed tests)%s\n' "$BOLD" "$RST" "$DIM" "$RST"
    # allow-any-unicode-next-line
    printf '  %s↳ http://localhost:6080/vnc.html?autoconnect=true&password=positron%s\n\n' "$DIM" "$RST"
  fi

  # --- On-Demand Services ---
  printf '%sOn-Demand Services%s\n' "$BOLD" "$RST"
  tcp 127.0.0.1 8080; odsvc "Server (Web)"  ":8080" "$?" "$SERVER_ERR" "http://localhost:8080/?tkn=dev-token"
  # Desktop intentionally has no inline URL: you view it via the "Live View" link above
  # (which already names the desktop). This row is just status — running / idle / failed.
  pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1
  odsvc "Desktop (Electron)" "VNC"   "$?" "$DESKTOP_ERR" ""
  tcp 127.0.0.1 9323; odsvc "Playwright Report"  ":9323" "$?" "" "http://localhost:9323"
  printf '\n'

  # --- Footer ---
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
  pgrep -x Xvnc >/dev/null 2>&1 && s+=X || s+=x
  tcp 127.0.0.1 5900 && s+=V || s+=v
  tcp 127.0.0.1 6080 && s+=N || s+=n
  tcp postgres 5432  && s+=P || s+=p
  tcp 127.0.0.1 8080 && s+=S || s+=s
  pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1 && s+=D || s+=d
  tcp 127.0.0.1 9323 && s+=R || s+=r
  # Fold in the mtime, not just presence: a re-fetch refreshes in place (same dir), so a
  # presence-only bit wouldn't change and the panel wouldn't redraw to show the new age.
  [ -d "$QA_DEST" ] && s+="Q$(stat -c %Y "$QA_DEST" 2>/dev/null)" || s+=q
  # Wrong-OS binary bit: redraw the moment a native build clobbers a binary mid-session.
  [ -z "$(wrong_os_bins)" ] && s+=I || s+=i
  [ -f "$SERVER_ERR" ] && s+=E || s+=e
  [ -f "$DESKTOP_ERR" ] && s+=F || s+=f
  pgrep -f "ci-arm/post-create.sh" >/dev/null 2>&1 && s+=B || s+=b
  # Build-marker mtime: Reinstall deps / Rebuild rewrite it (mark-build-state.sh), so the Build
  # card redraws when they finish — Reinstall never runs post-create.sh, so the B bit alone misses it.
  [ -f "$STATE/complete" ] && s+="C$(stat -c %Y "$STATE/complete" 2>/dev/null)" || s+=c
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
      printf '\e[H\e[2J\e[3J'  # home + clear screen + clear scrollback (no piled-up history)
      # Reuse sig's build-running bit (B) so render() doesn't re-probe the process table.
      case "$cur_sig" in *B*) building=1 ;; *) building=0 ;; esac
      render "$building"
      printf '\n%sauto-updates • any key refreshes • q quits%s\n' "$DIM" "$RST"
      printf "%sall tasks: Command Palette → 'Tasks: Run Task'%s\n" "$DIM" "$RST"
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
