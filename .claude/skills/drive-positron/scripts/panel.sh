#!/usr/bin/env bash
# The workbench chrome around the views: panel tabs, terminals, console
# sessions and editor tabs. Clicks are real, and each command says what it did
# or why it could not.
#
# Usage:
#   scripts/panel.sh --session NAME tab Terminal          # also Console, Output, Problems, Ports
#   scripts/panel.sh --session NAME sessions
#   scripts/panel.sh --session NAME sessions --all
#   scripts/panel.sh --session NAME console python        # or part of a name, or a session id
#   scripts/panel.sh --session NAME terminals
#   scripts/panel.sh --session NAME delete-session 'R 4.5.1'
#   scripts/panel.sh --session NAME editors
#   scripts/panel.sh --session NAME layout
#   scripts/panel.sh --session NAME resize secondary 600
#
# Commands:
#   tab NAME             show the panel tab whose label starts with NAME, and
#                        check a tab of that name reads as selected ("already"
#                        when it was). A tab's name is its label, without the
#                        badge count beside it ("Problems", not "Problems4"). A narrow panel folds some tabs into one,
#                        Additional Views: then it chooses NAME from that tab's
#                        menu and says so ("via"); the view chosen then shows
#                        as a tab of its own, folding another
#   sessions             the console sessions: name, id (python-1a2b3c4d),
#                        language, which is active, and "starting" for one
#                        still starting; "count". With one session (no tabs),
#                        its name is the one its console printed ("... started."),
#                        since the title bar names the foreground session, which
#                        can be a .qmd's kernel; one that printed nothing yet
#                        reads "(starting, not named yet)". Brings the Console
#                        view forward when another panel tab hides it.
#                        --all adds the sessions no console shows, notebooks'
#                        and Quarto documents', from the session picker
#                        (Interpreter: Select Session, opened and closed):
#                        each with "kind" (console, notebook, quarto), "name"
#                        (the interpreter), "document" (the file), the
#                        interpreter's path, and "foreground" for the one in
#                        front. A console session keeps its tab's id and
#                        active flag; two of one name pair by order (both
#                        lists run oldest first). When a name's rows and tabs
#                        do not line up (the picker leaves out an exited
#                        session), those rows get no id, and "note" says so
#   console WHICH        make a console the active one, without running code:
#                        WHICH is a language (python, r), part of a session's
#                        name, or its id (python-1a2b3c4d or the bare 1a2b3c4d),
#                        as console-run.sh --name matches; never the tab's whole
#                        label, which counts new executions. Fails, listing the
#                        sessions, when none or several match; "already" when
#                        it was active; "was" names the one active before
#   terminals            the terminals in the panel's terminal list, in order,
#                        and which is active
#   delete-session WORDS delete the console session whose tab name holds WORDS
#                        (or whose id is WORDS, as python-1a2b3c4d or the bare
#                        1a2b3c4d, when two share a name), through the tab's
#                        context menu; with one session (no tabs), the one
#                        session when its name holds WORDS or its id is
#                        WORDS, through the console toolbar's Delete Session
#                        button. Waits up to 10 s for it to go ("deleted"). When it is still there, "prompts" lists a
#                        question showing (a busy session may ask first; answer
#                        with notifications.sh), or "hint" says none is; like
#                        sessions, it brings the Console view forward first
#   editors              every editor tab, group by group: title (the tab's
#                        label), folder (the description beside two tabs of
#                        one name), path, active, modified. Read also while
#                        the editor area is hidden (the panel maximized):
#                        then "editorArea": "hidden" says so
#   layout               each workbench part's size in pixels, or hidden:
#                        sidebar, secondary (where Plots and Variables are),
#                        panel, editor
#   resize PART PX       drag the edge of sidebar, secondary or panel until it
#                        is PX wide (panel: PX tall), as a person drags the
#                        sash; a pane too narrow hides things (the Plots
#                        filmstrip), and a part has a minimum size: dragged
#                        below it, the part closes ("now": "hidden", and a note)
#
# No command lists the panel's own tabs: ui.sh read panel shows them. A word
# that is not a command is a usage error naming it (a part of a command's name
# says that command).
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the tab, terminal or
# session is not there, 2 on a usage error.

# Implemented in dp-panel.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" panel "$@"
