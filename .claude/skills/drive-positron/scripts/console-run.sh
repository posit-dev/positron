#!/usr/bin/env bash
# Runs code in the console of a named language's session, and checks it landed
# there. With a Python and an R session open, the active console is whichever
# was used last, so typing into "the console" sends R code to Python as often
# as not. This script picks the session's console first, pastes into its input,
# presses Enter, and confirms the code was echoed in that console.
#
# It does not start a session: start one first, and the script fails if there
# is none for the language. A session still starting shows its prompt (">>>")
# before it takes code, and code typed then is left at a continuation prompt,
# so the script waits up to 60 s for it to finish starting. When
# the Console view is behind another panel tab, it brings it forward first.
#
# The code is pasted as written: `\n` inside a string stays a backslash and an
# n. Code the console takes as unfinished (a Python block with no blank line
# after it, an open bracket) leaves it at its continuation prompt ("..." or R's
# "+") with nothing run, and the script fails and says so: end a Python block
# with an empty line. While an input() or readline() waits for an answer the
# console's input is hidden: the script presses no key and fails, with the
# question it asks in "waiting". Each call waits for its echo, so calls arrive seconds
# apart; to test changes in quick succession, send them in one call.
#
# Usage:
#   scripts/console-run.sh --session NAME --language r 'x <- 1:10'
#   echo 'import pandas as pd' | scripts/console-run.sh --session NAME --language python
#   scripts/console-run.sh --session NAME --language r --name "R 4.5.1" 'x'   # pick one of several R sessions
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      part of the session's name, as its console tab shows it,
#                    or its session id (r-9760fdda, or just 9760fdda) when two
#                    share a name; needed only when several sessions share the
#                    language. A --name that matches no session fails, also when
#                    there is only one session
#   --timeout SECS   how long to wait for the code to echo (default 10)
#   --capture        also wait for the code to finish (up to --capture-timeout,
#                    default 60 s) and return what it printed, as "output":
#                    the text after the echo of the code's last line (not
#                    after a traceback's frame of that same line), its rows
#                    as drawn, blank rows included
#   --capture-timeout SECS  see --capture. A --timeout or --capture-timeout
#                    that is not a positive number is a usage error, and
#                    nothing is typed
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"session":"R 4.5.1","sessionId":"r-cf28f473","switched":true,"busy":false,"echoed":true}
# Exit code: 0 when the code landed in the right console, 1 when it did not, 2 on a usage error
# (a --name given with no value or an empty one is one, and so is a flag it
# does not take, such as a misspelled --capture-timout: nothing is typed).
#
# Required tools on PATH: node, jq.

# Implemented in dp-console.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" console-run "$@"
