# `--edge-cases` Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `--edge-cases` flag to the QA agent that directs the planning phase to add input-variant steps for exercising different code paths.

**Architecture:** Three edits to `.claude/skills/qa-agent/SKILL.md` -- usage examples, flag docs, and a planning directive. No new files, no runtime changes.

**Tech Stack:** Markdown only.

---

### Task 1: Add `--edge-cases` to Input Formats and flag documentation

**Files:**
- Modify: `.claude/skills/qa-agent/SKILL.md:98-132`

- [ ] **Step 1: Add usage example**

In the Input Formats code block (~line 98), add this line after the `--context 12345 --deep` example:

```
/qa-agent 456 --edge-cases --build      PR diff, built app, with input diversity
```

- [ ] **Step 2: Add flag to "Other flags" list**

In the "Other flags" section (~line 127), add after the `--deep` entry:

```markdown
- `--edge-cases`: After planning core test steps, add 1-2 input variants per scenario to exercise different code paths (errors, empty values, special formatting, boundary conditions). Targets 10-20 total steps. Mutually exclusive with `--deep`.
```

- [ ] **Step 3: Verify formatting**

Read back lines 96-135 to confirm the new lines fit cleanly with surrounding content and indentation is consistent.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/qa-agent/SKILL.md
git commit -m "Add --edge-cases flag to QA agent input formats and docs"
```

### Task 2: Add mutual exclusivity check and planning directive to Step 1

**Files:**
- Modify: `.claude/skills/qa-agent/SKILL.md:163-196`

- [ ] **Step 1: Add mutual exclusivity validation**

At the top of Step 1 (~line 164), before the `**If free-text description:**` block, add:

```markdown
**Mutual exclusivity check:** If both `--deep` and `--edge-cases` are set, error immediately:
```
`--deep and --edge-cases are mutually exclusive. Use --deep for exhaustive data gathering, or --edge-cases for input diversity.`
```
```

- [ ] **Step 2: Add `--edge-cases` planning directive**

After the `**If PR number with `--deep`:**` block (after line 195, before the `**If `--branch` flag:**` block), add:

```markdown
**If `--edge-cases` flag is set:**

After planning the core 5-10 steps, do a second pass. For each core test step that
involves user-visible output or data transformation, add 1-2 additional steps that
test the same action with inputs designed to exercise different code paths. Vary the
*kind* of input -- errors vs clean output, empty vs populated, special characters vs
plain text, multi-line vs single-line. Target 10-20 total steps. Do not hardcode
specific edge cases -- reason about what inputs would reveal bugs in this specific
feature.
```

- [ ] **Step 3: Verify formatting**

Read back lines 163-210 to confirm both additions fit cleanly between the existing conditional blocks.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/qa-agent/SKILL.md
git commit -m "Add --edge-cases planning directive and mutual exclusivity check"
```
