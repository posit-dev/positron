#!/usr/bin/env bash
# Reads and drives Quarto inline output in the active .qmd editor: its cells,
# each cell's toolbar and run state, and the output drawn under each cell.
# Each command puts the cursor in the cell and the mouse over it, since a
# cell's toolbar shows only there, and clicks its toolbar buttons by name.
# It never presses Escape, which interrupts a running cell (SKILL.md).
#
# Inline output is opt-in: set "quarto.inlineOutput.enabled": true first.
# Turning it off shuts down the Quarto kernels.
#
# In a .qmd with cells of two languages, the first language's cells run in a
# hidden notebook kernel, not the console; the other language's cells go to
# that language's console, where console-read.sh reads them. For such a cell,
# state and read report whatever output is drawn under it, or none: what they
# find is a reading, not the behavior to expect.
#
# Usage:
#   scripts/qmd.sh --session NAME --file doc.qmd cells
#   scripts/qmd.sh --session NAME --file doc.qmd run 2
#   scripts/qmd.sh --session NAME --file doc.qmd wait 2 60
#   scripts/qmd.sh --session NAME --file doc.qmd stop 2
#   scripts/qmd.sh --session NAME --file doc.qmd state 2
#   scripts/qmd.sh --session NAME --file doc.qmd button 2 'Run this cell and all cells below'
#   scripts/qmd.sh --session NAME --file doc.qmd menu 2
#   scripts/qmd.sh --session NAME --file doc.qmd menu 2 'Insert Cell Above'
#   scripts/qmd.sh --session NAME --file doc.qmd clear 2
#   scripts/qmd.sh --session NAME --file doc.qmd link 2 'open in editor'
#   scripts/qmd.sh --session NAME read
#
# Commands:
#   cells           the code cells in the saved file: number, language, the
#                   lines of its opening and closing fences
#   state N         cell N's toolbar ("state": idle, queued, running,
#                   completed, error; "executionId": its last run's id, kept
#                   after the run, and still the previous run's while the
#                   cell is queued, until it starts; "buttons") and its
#                   output: status
#                   (running, pending, success, error, or none when the
#                   output shows no status line: it is hidden between runs,
#                   keeping its last words), footer, kinds (stdout, stderr,
#                   error, image, html, data-explorer) and text. The output
#                   sits under the closing fence: in a short editor, state
#                   moves the cursor there to read it
#   run N           click cell N's Run this cell once, wait up to 3 s for
#                   the cell to read differently and hold still for 300 ms,
#                   and report it: "toolbar" and "output" as state reads
#                   them after, "before" the same two before the click, and
#                   "changed" whether any of it differs. The last run's
#                   output stays under the cell until the new run prints, so
#                   an "output" equal to "before.output" is the last run's;
#                   a cell that prints nothing leaves only its toolbar's
#                   "executionId" changed. wait N, then state N, reads it
#                   once it is done
#   wait N [SECS]   wait until cell N's toolbar shows its Run this cell button
#                   (it reads Stop cell execution while the cell runs, Cancel
#                   pending execution while it waits), in two reads 500 ms
#                   apart, up to SECS (default 60; not a positive number:
#                   a usage error, nothing done); report the cell as state
#                   does, or fail naming the buttons it showed. It brings the
#                   cell back on screen as outputs above it grow; when it
#                   cannot, it fails saying so, with no output read
#   stop N          click Stop cell execution (Cancel pending execution when
#                   queued), and report the cell as run does; with neither,
#                   fail naming the buttons the toolbar shows (Run this cell
#                   once the cell has finished)
#   button N LABEL  click another of cell N's toolbar buttons by name: "Run all
#                   cells above this cell", "Run this cell and all cells
#                   below", "More cell actions"; report the cell as run does,
#                   and a menu it opened ("opened", "menu": its items)
#   menu N [ITEM]   More cell actions: with no ITEM, list its items ("items",
#                   "(off)" when disabled) and close it again; with ITEM,
#                   choose it (hover, then click, as ui.sh choose does) and
#                   report the cell and whether the file now has unsaved edits
#   clear N         click the Clear output button on cell N's output, and wait
#                   up to 3 s for the output to go ("cleared": true, or false
#                   with an error); refused while the cell runs: the button is
#                   Interrupt execution then
#   link N TEXT     click the link or button in cell N's output whose text or
#                   name holds TEXT (a truncated output's "(open in editor)",
#                   drawn as a button), after wheeling the editor until it is
#                   on screen, and report the active editor tab after
#                   ("activeEditor", "editorTabs", "newTabs"). Fails when the
#                   click opened or changed nothing within 3 s
#   read            every output on screen and the line it sits under, and the
#                   lines drawn ("visible"); a note says when the editor is
#                   scrolled past the end of the file, as it can be after a
#                   tall output at the end is cleared. Only outputs drawn are
#                   read (one above the view reads "above view"):
#                   "notRead" lists the cells whose closing fence is off
#                   screen, so their outputs were not read ("notReadNote")
#
# Flags:
#   --file NAME     refuse unless NAME is the active editor, after waiting up
#                   to 3 s for it (an open-file that just switched tabs); pass
#                   it every time, since a failed open-file leaves another
#                   file active
#
# Only the active editor is read. Tabs in one editor group share one editor
# widget: a background tab's editor is detached from the page, so its outputs
# cannot be read until open-file.sh brings it to the front.
#
# Each call takes 2-3 s, so to test an interrupt, run a cell
# that runs long, 60 s or more: a shorter one can finish between two calls.
#
# Every answer names the file. Cell lines come from the saved file, so with
# unsaved edits ("dirty") every command but state and wait refuses: save first.
# Before acting, each waits up to 3 s for the cell's toolbar to show (they are
# drawn again after a settings change).
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when there is no .qmd
# editor, cell or button, or a wait timed out, 2 on a usage error.

# Implemented in dp-qmd.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" qmd "$@"
