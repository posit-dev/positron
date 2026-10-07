#!/usr/bin/env bash
# Reads and edits the active text editor, as a person would with the keyboard,
# and answers with the editor as it reads after: its tab, unsaved edits
# ("dirty"), the cursor (and "selected" characters), the cursor line's text,
# and the lines the debugger marks ("debug": top frame and selected frame).
# Keys and text go in only while focus is in the editor; otherwise it refuses,
# with nothing pressed, since keys go wherever focus is. They go in at the
# cursor, wherever it is now, and other helpers move it: qmd.sh puts it in
# the cell it acts on, debug.sh break on the breakpoint's line. So goto first
# (or type --at), and read "actedAt", the line:column type, key and insert
# acted at.
#
# Usage:
#   scripts/editor.sh --session NAME read 1:20
#   scripts/editor.sh --session NAME cursor
#   scripts/editor.sh --session NAME goto 9
#   scripts/editor.sh --session NAME goto 9:5
#   scripts/editor.sh --session NAME type 'x <- 1'
#   scripts/editor.sh --session NAME type --at 9:5 'x <- 1'
#   scripts/editor.sh --session NAME key Enter
#   scripts/editor.sh --session NAME delete 3:5
#   scripts/editor.sh --session NAME insert 2 'y <- 2'
#   scripts/editor.sh --session NAME save
#   scripts/editor.sh --session NAME run
#   scripts/editor.sh --session NAME suggest --at 7:13
#   scripts/editor.sh --session NAME hover --at 7:11
#   scripts/editor.sh --session NAME definition --at 7:16
#
# Commands:
#   read [FROM:TO]   the editor, with the text of lines FROM to TO; only lines
#                    drawn on screen are there, so goto first for others
#   cursor           the editor, without lines
#   goto LINE[:COL]  put the cursor there, through Go to Line in the quick
#                    open, which centres the line; fail when it landed
#                    elsewhere: a shorter file, or a column past the line's
#                    end (the error says how long the line is), or a line not
#                    drawn on screen (it tries twice)
#   type TEXT        paste TEXT (or stdin) at the cursor; checks its last line
#                    is now there (or in the input that has focus, such as
#                    the breakpoint widget). --at LINE[:COL] goes there first
#   key KEY...       press keys, by Playwright's names: Enter, Backspace,
#                    Meta+z, Shift+ArrowDown. Keys that move, edit or select
#                    (arrows, Home, End, Page keys, Backspace, Delete, Enter,
#                    Tab, a character) must change the cursor, the drawn
#                    text, the unsaved state or the selection within 1 s.
#                    When none did, it presses an arrow out and back: if that
#                    moves nothing either, it fails ("the key changed
#                    nothing ... try window.sh reload", "probe"); if it does,
#                    the key had nowhere to go (End at the line's end) and it
#                    answers ok with "changed": false and a note. A last key
#                    with Shift (Shift+End) that leaves nothing selected fails
#                    either way. delete checks its Backspace the same way
#   delete FROM:TO   select whole lines FROM to TO and press Backspace
#   insert LINE TEXT put TEXT (one or more lines) before line LINE, ending it
#                    with one line break (a trailing one in TEXT is not
#                    doubled), and check the lines read back as TEXT then the
#                    old line ("inserted", "at": the lines it now fills)
#   save             Cmd/Ctrl+S, and wait until the tab has no unsaved edits
#   run              Cmd/Ctrl+Enter (run the line or selection in the
#                    console), and fail when no console showed it within 3 s
#   suggest          trigger completions (Ctrl+Space) at the cursor and read
#                    the list once it holds still: "rows" (each option's
#                    name: label, detail, kind), "shown" (rows drawn), "total"
#                    (rows in the list), "selected"; or "message" when the
#                    list says so ("No suggestions."); fails when neither
#                    showed within --timeout
#   hover            Show or Focus Hover (Cmd/Ctrl+K Cmd/Ctrl+I) at the
#                    cursor: "hover", its text (several hovers joined by
#                    ---); fails when none showed within --timeout (nothing
#                    to show, or no language server answered)
#   definition       Go to Definition (F12) at the cursor: the editor where
#                    the cursor landed (tab, line, column, text; "from" is
#                    where it was), or "found": false and "message" ("No
#                    definition found for 'x'"), or "peek" and its "rows"
#                    when several definitions open a peek, which it closes
#                    with its Close button; fails when nothing happened
#                    within --timeout
#   suggest, hover and definition take --at LINE[:COL] (goto first) and
#   --timeout SECS (default 5; not a positive number: a usage error, and
#   the cursor is not moved). The list and the hover are closed without
#   Escape, which in a .qmd interrupts a busy kernel whatever has focus: focus
#   leaves the editor (they close on blur) and comes back, the cursor where it
#   was ("closed", "focused").
#
# Which language server answered: a file can have several (Python: Pyrefly
# and Positron's Python Language Server; launch.sh --no-pyrefly leaves one).
# Turn on the trace with settings.sh set positron.r.trace.server verbose
# --user (python.trace.server for Python), then grep the run's logs for the
# request: grep -rl "textDocument/completion" <runDir>/logs. Each client logs
# to its own output channel's file: R Language Server.log (under
# positron.positron-r), "Pyrefly language server.log" (under
# output_logging_*), Python Language Server. Developer: Set Log Level...
# raises a channel's level.
#
# Stdout: one JSON line, e.g. {"ok":true,"tab":"dbg.R","dirty":false,"line":9,"column":1,"text":"f(5)",...}
# Exit code: 0 when it did what was asked, 1 when not (focus elsewhere, no
# text editor, the cursor or text not where asked, no list or hover, Go to
# Definition did nothing), 2 on a usage error.

# Implemented in dp-editor.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" editor "$@"
