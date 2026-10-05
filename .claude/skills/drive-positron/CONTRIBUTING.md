# Changing drive-positron's helpers

## How it works

`launch.sh` starts Positron with its Chrome DevTools Protocol (CDP) port open,
and Playwright attaches to the running app. Each helper is one shell command
that sends one small function into the page and prints one JSON line: what it
did and what is on screen. Helpers find the UI by accessible role and name, as
a screen reader would; `scripts/selectors.ts` holds the few CSS selectors for
what the accessibility tree lacks. Feature helpers (`plots.sh`, `qmd.sh`,
`debug.sh`, `nb.sh`) cover tricky surfaces; the generic `ui.sh` drives anything
else by role and name. Helpers fail loud and report what they see; the explorer
decides what it means. `test/check.ts`, `test/smoke.ts` and the drift check
keep them working.

## How a command is built

Most commands are three pieces:

1. **`scripts/X.sh`**: a header comment, then one line,
   `exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" X "$@"`. The header is the
   command's only reference: what it does, Usage, flags, stdout and exit codes.
   SKILL.md does not repeat it, so put every flag and output fact here.
2. **An entry in a `dp-*.ts` command table** (`xxxCommands`, spread into
   `dp.ts`): it parses the arguments with `parse(argv, [flags that take a
   value])`, calls `usage('X.sh')` on `--help` (which prints the header),
   logs the action with `log('X.sh', session, what, readout)`, and runs the
   page function with `inPage(session, fn, args)`. The readout is the key
   values the action returned (the plot shown, the cursor), cut to 160
   characters after "->". A read logs one line too, with
   `logRead('X.sh', session, values)`: the values read, cut the same way.
   A failure needs nothing: `dp.ts` logs every command that exits non-zero,
   with its arguments and error ("FAILED ..."). A bash recipe exports
   `DRIVE_POSITRON_QUIET_READS=1`, which quiets its calls' reads and
   failures (`DRIVE_POSITRON_QUIET_ACTIONS=1` its calls' actions), logs its
   own lines through `node dp.ts log X.sh "$SESSION" "..."`, and its failure
   through `node dp.ts fail X.sh "$SESSION" "$OUT" ARGS...` (debug.sh,
   plots.sh).
3. **A page function** typed `PageFn<A>`: `async (page, args, lib) => Json`.
   `inPage` sends it to the attached session as source text through
   `playwright-cli run-code`, so the whole command is one CLI call.

Three files serve them all:

- `dp-lib.ts`: the Node side (`inPage`, `log`, `parse`, `usage`, `pause`).
- `page-lib.ts`: `makeLib`, the `lib` every page function gets, in sections
  listed at its top. It travels with each page function as one unit.
- `selectors.ts`: every selector and accessible name the helpers use (below).

A few helpers are bash instead: recipes over other helpers (`debug.sh` over
`ui.sh` and `editor.sh`), and the ones that work outside the page (`launch.sh`,
`stop.sh`, `reseed.sh`, `listeners.sh`, `run-venv.sh`). They keep the same
header, and their `-h|--help` case is the one line
`-h|--help) exec node "$DIR/dp.ts" help "$0" ;;`, which prints it through the
same `usage()`. Never print help another way; `check.ts` runs every `.sh` with
`--help` and `-h` and compares the output with its header.

## Selectors and names

`scripts/selectors.ts` is the one place for a fact about Positron's UI:

- `css`: classes, test ids and product attributes, each with a note on what
  the accessibility tree lacks there. Roles and tags (`[role=grid]`, `img`)
  stay in the code.
- `names`: accessible names (buttons, menu items, toolbars, regions, view
  headings) and Command Palette titles the helpers find things by.

Page code reads `lib.css.GROUP.KEY` and `lib.names.GROUP.KEY`. A function
passed to `evaluate` cannot see `lib`, so pass it the group it needs:
`page.evaluate(c => document.querySelector(c.busy), lib.css.console)`. Node
code imports `{ css, names }`. Bash runs `eval "$(node "$DIR/selectors.ts"
names)"` and uses `$GROUP_KEY` (`$plots_previous`).

To add one, put it in its area's group with a short note, and read it from
there. `check.ts` fails on a class or test-id selector written in a helper, and
on an entry nothing reads. When the product renames something, change the entry
here; the helpers follow.

`test/drift.ts` checks every entry against `src/` and `extensions/`, so a
renamed class, test id or label is caught (nightly in CI, or run it on your
branch). If it reports an entry:

1. Find what the product calls the thing now, and change the entry it names
   in `selectors.ts` (the output lists the helper lines that read it).
2. Run `test/check.ts`, and `test/smoke.ts` if you can.

An entry drift.ts cannot map on its own (a new `...Pattern` name, a generic
word) gets a line in its tables: `PATTERNS`, `AREA` or `SKIP`, with the reason.

`launch.sh` is a fork of `.agents/skills/launch/scripts/launch.sh` (see
SKILL.md). On Windows it starts the app through WMI so R sessions survive; the
comment above that block says why. Do not simplify it to a direct spawn.

## Rules

- **Role and name first.** Find elements with `getByRole` and accessible names,
  as `ui.sh` does. Read the DOM only where the app exposes no role (Monaco's
  lines, the Data Explorer's cells), through a `selectors.ts` entry whose note
  says why.
- **Fail loud.** Return `{ ok: false, error }` when the command did not do what
  was asked, and refuse rather than guess: one target, or an error naming the
  count; no keys pressed unless focus is where they should go. Exit 0 on
  success, 1 on failure, 2 on a usage error. Report what changed, so a no-op
  reads as one.
- **Report, don't interpret.** A helper finds the element, acts once, and
  returns what is on screen before and after (status text, footer, toolbar,
  output); the explorer decides what it means ("ran", "finished", "the plot
  changed"). Where a helper waits, it waits for a visible change (a button's
  name, the view's tree), not an inferred product state.
- **Bounded waits.** Every wait has a timeout and ends in a clear error. Wait
  for a condition, not a fixed sleep.
- **Self-contained page functions.** A page function may use only `page`,
  `args` and `lib` (`makeLib` in `page-lib.ts`); an import or module constant is a
  `ReferenceError` the first time it runs. A function passed to `evaluate` and
  its kin runs in the browser and sees none of the page function's variables
  either: pass them as its argument. `check.ts` enforces both.
- **Real input.** Use Playwright's clicks and keys; several Positron buttons
  ignore a click from page script. Press Escape only when a quick input is open
  (`lib.closeQuickInput`) or a menu has focus (`lib.closeMenu`): with a `.qmd`
  in front and its kernel busy, Escape anywhere else interrupts the kernel,
  whatever has focus. Close a widget that closes on blur (the suggest list, a
  hover, the Accessible View) with `lib.blur`, then `lib.focusEditor`.
- **ASCII only**, tabs for indentation, and the copyright header on new `.ts`
  files.
- **Docs in one place.** A new command gets its header and one row in SKILL.md's
  "To do X, use Y" table. Every flag, wait and output fact goes in the header.
  A gotcha that no header can hold goes in SKILL.md once.
- **Generic first.** Before adding a feature-specific helper, try `ui.sh` and
  the generic commands; add one only when explorers in more than one run fell
  back to raw Playwright without it.

## Test it

From the repository root:

```bash
node .claude/skills/drive-positron/test/check.ts   # after any edit to scripts/, ~10 s
node .claude/skills/drive-positron/test/drift.ts   # the registry against src/, ~3 s (check.ts runs it too)
node .claude/skills/drive-positron/test/smoke.ts   # every helper on one instance, ~8 min
node .claude/skills/drive-positron/test/smoke.ts --quick   # one happy path per helper, ~2 min
```

In CI, `.github/workflows/drive-positron.yml` runs drift.ts (and check.ts
when this skill changed) nightly on main, with smoke.ts, or on a manual run.
The drift check on PRs that touch UI source is off for now: its
`pull_request` trigger is commented out. Both
jobs are warn-only (`continue-on-error: true`); to make one required, remove
that line and add the job to branch protection.

Every new command needs a smoke case, marked `quick: true` when it is the
helper's one happy path, and at least one failure case, in `test/smoke.ts`. [test/README.md](test/README.md) says what each check covers,
how a case is written, and how to tell product drift from a bug in a helper.
