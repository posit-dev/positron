# drive-positron tests

Three commands, all run from the repository root.

| Command | Needs | Time | Catches |
|---|---|---|---|
| `node .claude/skills/drive-positron/test/check.ts` | nothing running | ~10 s | our own mistakes in the scripts, and drift |
| `node .claude/skills/drive-positron/test/drift.ts` | nothing running, no install | ~3 s | product UI drift, read from src/ |
| `node .claude/skills/drive-positron/test/smoke.ts` | a built checkout, R, the positron-python venv | ~8 min (`--quick` ~2) | our mistakes and product UI drift |

Run `check.ts` after any edit to `scripts/`, and `smoke.ts --quick` after an
edit to a helper. Run the full `smoke.ts` before handing the helpers to an
exploratory run, and after a merge from main.

## check.ts: static checks

- **types**: `tsc -p ../tsconfig.json` over `scripts/*.ts` and `test/*.ts`
  (strict, no unused locals, and `erasableSyntaxOnly`, because Node runs these
  files by stripping types: an `enum` would type check but not run).
- **pagefn** (`page-fns.ts`): a function passed to `inPage` is sent to the page
  as `fn.toString()`, so it may use only `page`, `args` and `lib`. This check
  walks every function whose type is `PageFn`, and `makeLib`, and fails on any
  name declared in a script outside it (an import, a module constant): that is
  a `ReferenceError` the first time the command runs. It applies the same rule,
  one level tighter, to functions passed to `evaluate`, `evaluateAll`,
  `evaluateHandle` and `waitForFunction`, which run in the browser and cannot
  see the page function's variables either. Each run also checks a planted file
  with known violations, so the check cannot silently stop working.
- **lint**: the repo's `eslint`, errors only (it has warnings, from VS Code
  rules such as `code-no-in-operator`, that do not apply to these scripts), and
  ASCII only in `scripts/`, `test/` and the docs: write a product's non-ASCII
  label as an escape (`\u00B7`).
- **help**: every `.sh` parses (`bash -n`), its header comment has a Usage
  section, and `X.sh --help` and `X.sh -h` print exactly that header through
  `usage()` (a thin wrapper by its dp.ts command, any other script by its
  `-h|--help) exec node "$DIR/dp.ts" help "$0"` line); every command in a
  `dp-*.ts` command table has a `.sh` of the same name.
- **registry**: no helper writes a class, test-id or product-attribute selector
  in place (it belongs in `scripts/selectors.ts`), and every entry in
  `selectors.ts` is read by some helper.

- **drift**: drift.ts's MISSING entries (below).

## drift.ts: the registry against src/

For each entry in `scripts/selectors.ts` it asks whether `src/` and
`extensions/` still produce it (TS, TSX, CSS, `package.json` and
`package.nls.json`; not tests, `out/` or `node_modules`):

- a selector: each class in it is a word in the source (`.codicon-X` by its
  icon id `X`); roles, attributes, inline styles and tags are skipped. A
  `...TestId` is a `data-testid` that starts with it, a `...Class` a class
  that starts with it, an `...Attr` or `...Var` the word itself.
- a name: a string literal (a `localize()` text, a command title), or a
  template like `"Focus on {0} View"` whose filled-in parts are literals too.
  A palette title's category and title are found separately. A `...Pattern`
  maps, in the `PATTERNS` table, to the source strings it must match.
- a generic word (`.active`, `"Continue"`) only counts in its group's `AREA`
  (the directories that draw it); without one it is `SKIPPED`.

It prints MISSING and SKIPPED entries (`--all` adds FOUND) and a count, and
exits 1 on any MISSING. `--root DIR` checks another tree.

```
MISSING  css.tree.row  ".positron-tree-row"
         no .positron-tree-row
         used by: dp-tree.ts:29, dp-tree.ts:33
         hint: if the product renamed it, change css.tree.row in scripts/selectors.ts ...
```

A MISSING entry is either drift (find the new name in src/ and update the
entry) or a stale entry nothing produces anymore (remove the dead part).
drift.ts only proves the string exists somewhere, not that it is on the
element the helper looks at; smoke.ts proves that.

## smoke.ts: one run of every helper

It copies `fixture/` to `/private/tmp/dp-smoke-net1/ws` (with `.venv` linked to
the positron-python venv), launches one instance with a minimal seed profile
(`quarto.inlineOutput.enabled`, Pyrefly off), attaches the Playwright session
`net1`, and runs each case through its `.sh`, as an agent would. It prints one
line per case and a summary, and always stops the instance, also on Ctrl+C.
`--quick` runs only the cases marked `quick: true`: one happy path per helper,
and the cases those stand on. `--keep` leaves the instance running and prints
the `stop.sh` line; arguments after `--` go to the app (CI passes
`--no-sandbox` and software-GL flags).

Each `// ----` section of `cases` is a group in `groups`, with a setup that
builds what its cases need from earlier sections (an R session, a defined
function, an open file). `--until NAME` runs NAME's group: its setup (printed
as `setup: ...`), then its cases through NAME, about 2.5 minutes at most.
`--from-start` with it replays every case through NAME instead, for a failure
that needs an earlier section's state. The full run goes through the groups in
order and skips the setups.

```
PASS   1830 ms  start-session r
FAIL    912 ms  de-read cars.csv
       exit 1: {"ok":false,"error":"no Data Explorer grid in the active editor"}
KNOWN  3012 ms  console-run r --capture
       known: <reason>
```

A case passes when the command exits 0 with `ok: true` and its `check`
returns nothing. A failure case (`fail: true`) passes only when the command
exits non-zero with `ok: false` and an `error`, so a helper that stops failing
loudly is caught; its `check`, if it has one, then reads the error (that it
names the dialog in the way, say). Read checks look for a value from the fixture (`smoke 42`,
the CSV's `bravo` row, `nb-product 42`), so they prove the helper read the
right thing, not just something.

`KNOWN` marks a failure that is understood and not fixed yet: the case has a
`known: 'reason'` field. It does not fail the run, but it is printed with its
reason on every run; a known case that passes says so on its line; remove the mark once it
passes every run (some known failures are timing races that pass now and then).

## When the nightly smoke fails

1. **Read the failing line.** Each case is named for the helper it runs
   (`qmd run 1`, `plots prev`), and the line under it is the helper's own
   error. That error names the registry entry it looked for (`no visible
   button "Show Next Plot" in Plots`, `no cell toolbar beside line 9`) or
   the change it waited for (`"Run this cell" did not show on cell 1's
   toolbar within 30 s`), often with the view as it read then.
2. **Decide which side moved.** Rerun the case's command by hand against
   `smoke.ts --keep` and read the view with `ui.sh read VIEW`. If the
   product now calls the thing something else (a renamed label, class or
   test id; `drift.ts` often names it too), that is product drift: change
   the entry in `scripts/selectors.ts`, or file the regression. If the view
   still shows what the helper looks for, the helper is wrong: fix the
   helper, not the case.
3. **Check the fix.** `node .claude/skills/drive-positron/test/check.ts`,
   then `node .claude/skills/drive-positron/test/smoke.ts --quick` (about 2
   minutes), and the full run before you push.

## Adding a command

1. Put the command in a `dp-*.ts` command table and write its `X.sh` with a
   header holding `Usage:`. `check.ts` fails until both exist. Any selector or
   name it needs goes in `scripts/selectors.ts`.
2. Add cases to the `cases` list in `smoke.ts`, in the section of its area:

   ```ts
   { name: 'thing read', run: ['thing.sh', 'read'], check: o => includes(o.json!.rows, 'bravo') },
   { name: 'thing read missing view', run: ['thing.sh', 'read', 'No Such View'], fail: true },
   ```

   `run` is the `.sh` and its arguments without `--session`; a function
   (`() => [...]`) can use values earlier cases saved in `found`. `check` gets
   `{ code, json, text, stderr }` and returns a message when something is
   wrong. `wait` (ms) waits before the case; `retry: N, retryOn: /re/`
   tries again, 3 s apart, while the problem matches (only for something
   genuinely on its way that the helper cannot wait for itself; prefer a
   bounded wait in the helper; the line shows the tries). Add at least one
   failure case, with the helper's shortest timeout where it takes one: the
   point is that it fails loudly, not how long it waits. Mark the helper's
   happy path `quick: true`, and any case it stands on. A case that needs
   state from an earlier section needs it in its group's setup too: check
   with `smoke.ts --until "<the section's last case>"`.
3. If the command needs content, add it to `fixture/` (an R and a Python file,
   a `.qmd`, an `.ipynb`, a CSV) and assert on a value only that content has.

## In CI

`.github/workflows/drive-positron-nightly.yml` builds Positron as
`test-e2e-ubuntu.yml` does, in the same image, adds Quarto, and runs smoke.ts
every weekday night (03:30 UTC) or on a manual run, then fixes the helper bugs
it finds (see [../heal/README.md](../heal/README.md)). Drift is not checked on
PRs; run drift.ts locally after renaming UI that the registry reads.
