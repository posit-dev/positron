# Diagnosis block -- reference

Read this only when the triage leads to a PR (fix-the-test or product-bug fix)
or a durable triage record. This skill doesn't open PRs itself.

Append an `### E2E Triage Diagnosis` block to the **end** of the PR body, after
whatever body template the change itself calls for (plain Summary/QA Notes for a
test-only change; the product PR template for a source fix -- see
`positron-pr-helper`'s `references/pr-templates.md` for required fields like
`Fixes #`, `### Release Notes`, `### Validation Steps`; easy to forget when the
diagnosis block is top of mind). The block is an **immutable snapshot** of the
root-cause prediction at authoring time, so its accuracy can be scored later.

```
### E2E Triage Diagnosis

<details>
<summary>🟢 <b>High confidence</b> -- <one-line hypothesis summary></summary>

- **Test:** [<full hierarchical test title>](<test_detail_view_url>)
- **Targeted failure:** <exact surface error/assertion string, e.g. `Test timeout of 120000ms exceeded`>
- **Signal:** <trace-timeline mechanism observation, not the bare assertion string>
- **Frequency:** <count/percentage + environment, e.g. "5/313 runs (1.6%), ubuntu/electron">
- **Hypothesis:** <root-cause mechanism -- race / isolation / contention / infra / product-bug>

</details>
```

If prior triage found a merged PR whose fix didn't hold, add a **Supersedes**
bullet: `Supersedes: #123 (hypothesized <one-line>, recurred N times after
merge)` so a later reader sees this is attempt #2 without re-running the
ancestry check.

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
- **Confidence emoji:** 🟢 high, 🟡 medium, 🔴 low. Keep the word "confidence"
  in plain text next to the emoji so the block stays greppable for scoring.
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

To find every PR carrying a diagnosis:

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url
```

When appending to an existing PR, edit the body with
`gh api repos/<owner>/<repo>/pulls/<n> -X PATCH -F body=@<file>` -- `gh pr edit`
fails on the Projects-classic GraphQL deprecation.
