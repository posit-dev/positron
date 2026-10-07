#!/usr/bin/env bash
# Prints the text of one session's console, without switching to it. Reading
# `.console-instance` text from the page joins every console together, and a
# console the Run App button starts is named after the app ("Shiny"), not the
# language, so this picks the console by language or by part of its name.
#
# Usage:
#   scripts/console-read.sh --session NAME --language r
#   scripts/console-read.sh --session NAME --name Shiny --tail 20
#   scripts/console-read.sh --session NAME --language python --after 'df.describe()'
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      part of the console's name, as its tab shows it, or its
#                    session id (r-9760fdda, or just 9760fdda) when two share a
#                    name; with --language, narrows to one of several sessions.
#                    A --name that matches no session fails, also when there
#                    is only one session
#   --tail N         print only the last N lines (default 40; 0 for all);
#                    anything but a whole number is a usage error
#   --after TEXT     print only what follows the line of TEXT, such as the
#                    code you just ran. It prefers the command's echo: a
#                    prompt line (>, >>>, +, ..., Browse[1]>) whose code is
#                    exactly TEXT, then a prompt line holding TEXT, then any
#                    line holding it; of several in that order's first tier
#                    to match, the last. Stderr says how many matched and
#                    which line was used. Fails when no line holds TEXT
#   --expand         click every Show Traceback in the console first, so an
#                    error's traceback frames are in the text
#   --prompt         print only the prompt the console's input shows now:
#                    R's ">" or "Browse[1]>" while paused in the debugger, "+"
#                    mid-expression; Python's ">>>". While an input() or
#                    readline() waits for an answer, the console hides its
#                    input and asks in the output: then it prints that
#                    question ("name?"), trimmed, and stderr says an input
#                    request waits. When neither shows (the console draws no
#                    prompt while code runs), it fails with exit 1
#
# With no --language or --name, it reads the active console. The text is the
# console's rows as drawn, blank rows included, one per line.
#
# An error's traceback is collapsed behind Show Traceback, and its frames are
# not in the text until it is expanded: stderr then says how many are
# collapsed. --after TEXT matching only a line of a traceback's code ("---->
# 4 f()") prints what follows that line, which can be just "Show Traceback".
#
# Stdout: the console text, then nothing else. Stderr: which console it read,
# its prompt ("no prompt" when none shows, with the question of an input
# request that waits), the tracebacks collapsed or expanded, and the --after match.
# Exit code: 0 when it read a console, 1 when none matched or --prompt found
# no prompt, 2 on a usage error
# (a --language, --name or --after given with no value or an empty one is one).
#
# Required tools on PATH: jq.

# Implemented in dp-console.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" console-read "$@"
