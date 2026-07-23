# Migration note -- triage-e2e-test cost refactor

## What changed

The skill went from a single 626-line linear `SKILL.md` to a ~180-line
orchestrator plus reference files and helper scripts. Behavior and guardrails
are preserved; the change is about **when** instructions, evidence, and logs
enter the model's context.

- **`SKILL.md`** is now an orchestrator: workflow stages, guardrails, decision
  points, script invocations, checkpoint behavior, and links to references.
- **`references/`** holds the detailed procedures, read only when a stage needs
  them: `history-query.md`, `prior-triage.md`, `evidence-escalation.md`,
  `reproduction.md`, `diagnosis-block.md`.
- **`scripts/`** moves deterministic work out of the model:
  - `triage-history.js` -- dual-branch query + merge + classify + compact output
    (was manual: run the raw query twice, merge by hand, print full JSON).
  - `find-prior-triage.js` -- filtered prior-triage lookup + ancestry partition
    (was `gh search prs ... --limit 50` pulling up to 50 full PR bodies).
  - `fetch-pattern-evidence.js` -- summary-first evidence, full payload on disk
    (was the raw S3 processor printing multi-megabyte JSON to stdout).
  - `checkpoint.js` -- durable state for start / resume / status (new).

The scripts still **wrap** the shared `e2e-failure-analyzer` scripts -- no
copies, no behavior change to the run-centric skill.

## New: work directory + checkpoints

Each triage gets `.claude/work/triage-e2e-test/<triage-id>/` (already gitignored
via `.claude/`). It holds `state.json`, raw history/evidence/prior-triage
payloads, and per-pattern evidence summaries. A triage can pause (e.g. across a
`/clear`) and resume with `--resume <id>` without repeating completed work.

## New: default one occurrence per pattern

`triage-history.js` defaults to `--occurrences-per-pattern 1` (was 2). Fetch a
second occurrence only for a stated reason (repeatability, race hypothesis,
same-file adjacency, conflicting evidence, checking whether a fix held).

## Compatibility notes

- Scripts are plain Node ESM (`.js`), invoked as `node <script>.js`, matching
  the other 10 skill scripts (no build step, no TypeScript loader). Pure
  transforms are exported and covered by `node --test` in `scripts/test/`.
- The `e2e-failure-analyzer` scripts and its `rubric.md` are unchanged; this
  skill only adds wrappers around them.
- A stale untracked copy may exist at `.agents/skills/triage-e2e-test/SKILL.md`
  (an older mirror). It is not part of this skill; the tracked skill lives under
  `.claude/`.

## Running the script tests

```bash
node --test .claude/skills/triage-e2e-test/scripts/test/*.test.js
```
