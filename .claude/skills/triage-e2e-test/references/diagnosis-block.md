# Diagnosis block -- reference

Read this when the triage leads to a PR (fix-test / fix-product) or a filed
issue (file-issue). This skill doesn't open PRs itself.

**`record-diagnosis.js` renders and appends the block for you** from the
checkpoint `diagnosis` object plus the test title / dashboard URL / frequency
pulled from history. **Never hand-write or reconstruct it** -- hand-formatting
drifts from the renderer, breaks the per-test `Test` line a scorer greps for, and
leaves `diagnosisBlockRecorded` unset (which gates `phase=done`). Save the fields
below and use `--dry-run` to preview the exact output. This reference covers what
each field must contain and the invariants the renderer relies on.

The block lands at the **end** of the PR body, after
whatever body template the change itself calls for (plain Summary/QA Notes for a
test-only change; the product PR template for a source fix -- see
`positron-pr-helper`'s `references/pr-templates.md` for required fields like
`Fixes #`, `### Release Notes`, `### Validation Steps`; easy to forget when the
diagnosis block is top of mind). The block is an **immutable snapshot** of the
root-cause prediction at authoring time, so its accuracy can be scored later.

## Required fields

Saved on the checkpoint under `diagnosis`. These are the rendered fields, not
every key on `diagnosis`. **Only `confidence` and `summary` are hard-validated**
by `record-diagnosis.js` (a bad value fails before anything is written); the rest
render as `n/a` when missing rather than failing, so "required" below is the
standard the block is held to, not a guarantee the script enforces. `--dry-run`
is how you catch a thin block:

| Field | Required | Shape |
|---|---|---|
| `confidence` | yes | `high` \| `medium` \| `low` (renders as 🟢 / 🟡 / 🔴 beside the word "confidence", kept in plain text so scoring can grep it) |
| `summary` | yes | one line, no newlines, not overlong |
| `targetedFailure` | yes | see below |
| `signal` | yes | see below |
| `hypothesis` | yes | race / isolation / contention / infra / product-bug |
| `supersedes` | only after `recurred-after-fix` | `#123 (hypothesized <one-line>, recurred N times after merge)` |

`fixApproach` is also saved on `diagnosis`, by the fix-approach gate, so the
agreed direction survives the `/clear`. It is checkpoint-only -- neither
validated nor rendered -- which is why it isn't in the table above. Save it
anyway.

The test title, dashboard link, and **Frequency** clause are not yours to write
-- the renderer pulls them from history so they can't drift from the data.

## Field notes

- **Test leads every block -- never drop it.** The **full hierarchical test
  title** (every enclosing `test.describe()` joined with `" > "`), rendered as a
  plain markdown link with no backticks: `[<title>](<url>)`. It's the block's
  identity -- what makes it findable and scoreable per-test. A product-bug block
  whose fix lives in source still gets it: the diagnosis is keyed to the test
  that surfaced it, not the file being changed. The spec path is not a separate
  bullet -- it's carried in the link's `test_detail_view_url`. When one block
  covers multiple tests, give each its own `Test` bullet, never a prose
  "`testA` and `testB`" a per-test search won't match.
  - **Link the Test title to the dashboard.** Use the `testDetailViewUrl` from
    `triage-history.js`'s output verbatim; don't hand-build it. It's a Connect
    app behind auth (anonymous fetch 401s) -- that's fine, it's a link for a
    logged-in human. If the field is absent (older API), fall back to the plain
    unlinked title (still no backticks).
- **Targeted failure names the surface error, not the mechanism.** The row from
  the failure table you set out to fix -- the raw assertion/timeout string as CI
  reported it, nothing more -- so a later scorer can tell whether a recurrence
  is the same mode. Don't append pattern letters or other modes' disposition.
- **Signal is the highest-leverage field, and the easiest to get lazy on.** The
  timeline shape from the evidence -- what the trace or snapshot actually showed
  ("markers render right after import, then disappear before the assertion
  runs") -- not the failure-pattern string ("`toBeVisible()` timed out"), which
  can't tell "never rendered" from "rendered then clobbered": two unrelated root
  causes.
- **Frequency** is its own bullet -- a different kind of evidence (how often /
  where) than the Signal mechanism observation.
- `<details>` collapsing is rendering-only: `gh api` / `gh pr view --json body`
  still return the full text, so nothing is lost for scoring.

## Do not rewrite after merge

Do NOT edit the block after merge to record whether the hypothesis was right --
that rewrites a merged PR description as ground truth arrives late. Outcome
scoring lives in a separate log keyed by PR number.

Searching for existing blocks, and appending one without the script, are in
[`script-fallbacks.md`](script-fallbacks.md).
