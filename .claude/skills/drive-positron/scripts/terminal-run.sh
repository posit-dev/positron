#!/usr/bin/env bash
# Runs a command in a terminal, and checks the keys went to it. Typing into
# "the terminal" goes wherever focus is, and a console often has it, so a
# command meant for a shell runs as R or Python instead. This script focuses
# the terminal, pastes into its own input, presses Enter, and checks
# focus stayed. A terminal's sticky-scroll overlay does not count as a terminal.
#
# Open a terminal first (Terminal: Create New Terminal, or Terminal: Create
# New Terminal in Editor Area). When no terminal is visible (another panel
# tab, such as the Console after console-run.sh, hides them), it runs
# Terminal: Focus on Terminal View, waits up to 3 s for a terminal to show,
# and says so ("broughtForward"). The product makes a terminal when that view
# is shown with none, so with no terminal open the command goes to a new
# shell. --read prints the
# terminal's text through the Accessible View, the text a screen reader gets,
# since the terminal itself is drawn on a canvas.
#
# Usage:
#   scripts/terminal-run.sh --session NAME 'node mcp.mjs list'
#   scripts/terminal-run.sh --session NAME --index 2 'ls'   # with two terminals visible
#   scripts/terminal-run.sh --session NAME --read --tail 20
#
# The command is one quoted argument (or stdin); a second one, or any with
# --read or --key, is a usage error, and so is "read" alone (pass --read).
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --index N        which visible terminal, numbered left to right then top to
#                    bottom; needed only when more than one is visible
#   --key KEY        send a key instead of a command, such as Control+c to stop
#                    a server, or Control+d; KEY is a Playwright key name
#   --read           print the terminal's text instead ("text"); --tail N for
#                    the last N lines. It reads until two reads 500 ms apart
#                    agree and the last command shows output, for up to 5 s;
#                    then "note" says it may still be running
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"index":1,"visible":1,"entered":true}
# Exit code: 0 when the command went to the terminal, 1 when it did not, 2 on a usage error.
#
# Required tools on PATH: node, jq.

# Implemented in dp-terminal.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" terminal-run "$@"
