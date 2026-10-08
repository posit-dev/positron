#!/usr/bin/env bash
# Starts a new console session for a language and waits until its console is
# ready for input. The console's Quick Launch control opens a menu, not a quick
# pick, and its references change between snapshots, so this goes through the
# Command Palette instead: Interpreter: Start New Console Session, then the
# runtime picker row that names the language (and --name, when several
# interpreters of that language are installed).
#
# A fresh window has often started a session already: Python when the
# workspace has a venv, R when it has .R files. When a session of the language
# (and --name) is open, this starts none and reports it ("started": false,
# "sessions"); pass --new to start another. panel.sh sessions lists them all.
# Interpreter discovery takes a while after launch; "no row matches" early on
# can mean it has not finished.
#
# Usage:
#   scripts/start-session.sh --session NAME --language r
#   scripts/start-session.sh --session NAME --language python --name 3.14.6
#   scripts/start-session.sh --session NAME --language r --new
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      words the picker row must also hold, each a whole word,
#                    such as a version or "uv"; needed only when several
#                    interpreters match. It is typed into the picker's filter
#                    first, so a row below the ones on screen is found; the
#                    filter takes words in the order the row shows them, and
#                    when it leaves no match the unfiltered rows on screen
#                    are tried. When no row matches, the error's "shown"
#                    lists every interpreter of the language in the picker,
#                    the rows below the screen too, to choose --name from;
#                    "more" is set when the list had rows it could not read
#   --timeout SECS   how long to wait for the console to be ready (default 60),
#                    and, first, for a session that is still starting; a
#                    value that is not a positive number is a usage error
#   --new            start a session even when one of the language (and
#                    --name) is open already
#   --answer BUTTON  answer a dialog that holds start-up with this button, such
#                    as "Not Now" for "Create a virtual environment for this
#                    workspace?", and keep waiting for the console
#
# Before it opens the picker, it waits for any session still starting (up to
# --timeout), since a new one would queue behind it. Right after launch the
# picker lists interpreters as discovery finds them; while it lists none of the
# language, this reopens it every 2 s for up to 30 s, then fails saying so.
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"started":true,"runtime":"R 4.5.1","sessionId":"r-1a2b3c4d","session":"R 4.5.1"}
#   {"ok":true,"started":false,"sessionId":"r-5e6f7a8b","session":"R 4.5.1","sessions":["R 4.5.1 (r-5e6f7a8b)"],"note":"..."}
# The sessionId is what console tabs and the MCP tools name the session by;
# with several open sessions matching, it is null and "sessions" lists them.
# Exit code: 0 when the console is ready, 1 when it is not, 2 on a usage error
# (a --name or --answer given with no value or an empty one is one).
#
# Required tools on PATH: node, jq.

# Implemented in dp-console.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" start-session "$@"
