# Exploratory Testing in CI -- Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `workflow_dispatch` workflow that builds a branch's Positron, drives it with the `exploratory-testing` v1 skill through an Agent SDK harness, and reports findings to the step summary, an artifact, and S3.

**Architecture:** One workflow (`pr-exploratory-test.yml`) with one job (`explore`) running in the `positron-ubuntu24` container. The job reuses the build recipe from `test-e2e-ubuntu.yml`, launches Positron outside Playwright via `.claude/skills/drive-positron/scripts/launch.sh` under Xvfb, then hands control to a composite action whose `run.mjs` drives the Claude Agent SDK. The agent uses `Bash` to drive the app through `npx @playwright/cli`.

**Tech Stack:** GitHub Actions (composite actions, containers), Node 20, `@anthropic-ai/claude-agent-sdk`, `@playwright/cli`, Electron/Xvfb, AWS S3 + CloudFront, 1Password secrets action.

**Spec:** `docs/design/2026-09-21-pr-exploratory-testing-design.md`

## Global Constraints

- **Phase 2 is out of scope.** No `issue_comment` trigger, no `gate` job, no PR comments, no reactions. Do not add them.
- Tabs for indentation in TypeScript/JavaScript, not spaces.
- ASCII only. No em-dashes, en-dashes, smart quotes, or other non-ASCII punctuation. Use ASCII hyphens and straight quotes.
- Every new `.mjs` / `.ts` file needs the Posit copyright header (see Task 3).
- Container image is pinned: `ghcr.io/posit-dev/positron-ubuntu24:24.18.0`.
- Never `git add -A` in this worktree -- the `node_modules` symlink gets tracked. Stage explicit paths.
- Never push directly to `main`. Every task's commit lands on a branch and reaches `main` through a PR.
- Run `npm run precommit -- <file>` before each commit; the hook checks unicode, indentation, copyright headers, formatting, and eslint.
- Do NOT run `npx tsc` or `tsc --noEmit` against the main project.
- The job's `timeout-minutes: 90`.
- Turn cap starts at `maxTurns: 200`.

## A note on how these tasks are tested

This is CI plumbing. Most tasks cannot be tested on your laptop: they need the
Linux container, the GHCR credentials, and the 1Password service account. The
test cycle for those is **merge the workflow to `main`, dispatch it against your
working branch, read the run**. That is why Task 1 merges a skeleton before
anything else works -- a `workflow_dispatch` workflow is not triggerable at all
until its file is on the default branch.

Task 3 is the exception. The pure logic in `run.mjs` is extracted into
`lib.mjs` and covered by real `node --test` unit tests you can run locally in
under a second. Write those tests first.

---

### Task 1: Skeleton workflow that builds Positron in the container

**Files:**
- Create: `.github/workflows/pr-exploratory-test.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a dispatchable workflow named `Test: Exploratory (dispatch)` with a
  `ref` input, and a job `explore` that leaves a compiled Positron at
  `$GITHUB_WORKSPACE/out` and an Electron binary at `.build/electron`.

This task deliberately stops short of launching the app. It proves the build
recipe transplants cleanly, which is the boring half of the risk, and it gets
the file onto `main` so later tasks can be dispatched at all.

- [ ] **Step 1: Write the workflow file**

```yaml
name: "Test: Exploratory (dispatch)"

on:
  workflow_dispatch:
    inputs:
      ref:
        description: "Branch to explore."
        required: true
        type: string

permissions:
  id-token: write
  contents: read
  packages: read

concurrency:
  group: pr-exploratory-${{ inputs.ref }}
  cancel-in-progress: true

jobs:
  explore:
    name: explore
    timeout-minutes: 90
    runs-on: ubuntu-latest-8x
    container:
      image: ghcr.io/posit-dev/positron-ubuntu24:24.18.0
      options: --user 0:0 --init
      credentials:
        username: ${{ secrets.POSITRON_GITHUB_RO_USER }}
        password: ${{ secrets.POSITRON_GITHUB_RO_PAT }}
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      POSITRON_BUILD_NUMBER: 0
      HOME: /root
      R_LIBS_SITE: /usr/local/lib/R/site-library
      R_LIBS_USER: /usr/local/lib/R/site-library
      RETICULATE_PYTHON: /root/.venv/bin/python
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref }}
          fetch-depth: 0
          submodules: recursive
          persist-credentials: false

      - name: Resolve diff base
        id: base
        shell: bash
        run: |
          set -euo pipefail
          # fetch-depth: 0 fetched all branches, so origin/main is present.
          BASE=$(git merge-base origin/main HEAD)
          echo "base=$BASE" >> "$GITHUB_OUTPUT"
          echo "head=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
          echo "Diff base: $BASE"
          git --no-pager diff "$BASE"...HEAD --stat

      - name: Restore caches
        id: restore-caches
        uses: ./.github/actions/restore-build-caches

      - name: Install node dependencies
        if: steps.restore-caches.outputs.cache-npm-core-hit != 'true' ||
            steps.restore-caches.outputs.cache-npm-extensions-volatile-hit != 'true' ||
            steps.restore-caches.outputs.cache-npm-extensions-stable-hit != 'true'
        uses: nick-fields/retry@v4
        env:
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1
          ELECTRON_SKIP_BINARY_DOWNLOAD: 1
          POSITRON_GITHUB_RO_PAT: ${{ github.token }}
          POSITRON_PARALLEL_INSTALL: '0'
          POSITRON_NPM_CONCURRENCY: '10'
          NPM_CONFIG_AUDIT: 'false'
          NPM_CONFIG_FUND: 'false'
          NPM_CONFIG_UPDATE_NOTIFIER: 'false'
          NPM_CONFIG_DEVDIR: '.node-gyp-cache'
          DOCKER_CONFIG: /tmp/.docker
          POSITRON_EXTENSIONS_FILTER: ${{ (steps.restore-caches.outputs.cache-npm-extensions-volatile-hit == 'true' && steps.restore-caches.outputs.cache-npm-extensions-stable-hit != 'true' && 'stable') || (steps.restore-caches.outputs.cache-npm-extensions-volatile-hit != 'true' && steps.restore-caches.outputs.cache-npm-extensions-stable-hit == 'true' && 'volatile') || '' }}
        with:
          timeout_minutes: 30
          max_attempts: 3
          retry_wait_seconds: 5
          shell: bash
          command: bash scripts/install-npm-parallel.sh

      - name: Download binaries (Ark, Kallichore)
        uses: ./.github/actions/download-binaries
        with:
          cache-hit: ${{ steps.restore-caches.outputs.cache-npm-extensions-volatile-hit == 'true' ||
                         steps.restore-caches.outputs.cache-npm-extensions-stable-hit == 'true' }}

      - name: Install E2E test dependencies
        run: npm --prefix test/e2e ci --prefer-offline --no-audit --no-fund

      - name: Compile Positron and Download Electron
        run: npm exec -- npm-run-all --max-old-space-size=8192 -p compile "electron x64"

      - name: Prelaunch
        run: npm run prelaunch

      - name: Set permissions on SUID sandbox helper
        run: |
          ELECTRON_ROOT=.build/electron
          sudo chown root $ELECTRON_ROOT/chrome-sandbox
          sudo chmod 4755 $ELECTRON_ROOT/chrome-sandbox
          stat $ELECTRON_ROOT/chrome-sandbox

      - name: Setup E2E Test Environment
        uses: ./.github/actions/setup-test-env
        with:
          aws-role-to-assume: ${{ secrets.QA_AWS_RO_ROLE }}
          aws-region: ${{ secrets.QA_AWS_REGION }}

      - name: Prove the build is the branch
        shell: bash
        run: |
          set -euo pipefail
          test -d out || { echo "out/ missing -- compile did not run"; exit 1; }
          echo "out/ present, $(find out -name '*.js' | wc -l) js files"
```

- [ ] **Step 2: Lint the workflow locally**

Run: `npm run precommit -- .github/workflows/pr-exploratory-test.yml`
Expected: PASS. If `actionlint` is wired into the hook it will also parse the YAML.

Sanity-check the YAML parses. Use the repo's own `js-yaml` -- `pyyaml` is not
installed in this environment, so a `python3 -c "import yaml"` check cannot run:

Run: `node -e "const y=require('js-yaml'),f=require('fs');const d=y.load(f.readFileSync('.github/workflows/pr-exploratory-test.yml','utf8'));console.log('steps:',d.jobs.explore.steps.length)"`
Expected: `steps: 11`

- [ ] **Step 3: Commit and open a PR**

```bash
git checkout -b midleman/exploratory-ci-skeleton
git add .github/workflows/pr-exploratory-test.yml
git commit -m "ci: skeleton exploratory-testing workflow (build only)"
gh pr create --title "ci: skeleton exploratory-testing workflow (build only)" --body "$(cat <<'BODY'
### Summary
Adds a dispatch-only workflow that builds Positron in the CI container. Build recipe only; nothing launches the app yet.

- New `pr-exploratory-test.yml`, `workflow_dispatch` with a `ref` input
- Build steps lifted from `test-e2e-ubuntu.yml`
- Must land on `main` before it can be dispatched at all

### QA Notes
No test impact. Verify by dispatching after merge.
BODY
)"
```

- [ ] **Step 4: Merge, then dispatch against a working branch**

The workflow is not listed in the Actions tab until it is on `main`. After merge:

Run: `gh workflow run pr-exploratory-test.yml --ref main -f ref=<your-branch>`
Then: `gh run watch $(gh run list --workflow=pr-exploratory-test.yml --limit 1 --json databaseId --jq '.[0].databaseId')`

Expected: job succeeds. "Prove the build is the branch" prints a non-zero js
file count. Note the wall-clock time of the build steps -- you will compare
against the spec's ~11.5 min warm / ~16 min cold.

---

### Task 2: Launch Positron in the container and drive one action

**Files:**
- Modify: `.github/workflows/pr-exploratory-test.yml`

**Interfaces:**
- Consumes: the compiled `out/` and `.build/electron` from Task 1.
- Produces: env vars `CDP_PORT`, `RUN_DIR`, `POSITRON_PID` available to later
  steps, and an artifact `exploratory-launch-proof` containing a screenshot.

This is the unproven part of the whole design. Nobody has run `launch.sh` as
root inside this container. Everything after this task depends on it.

- [ ] **Step 1: Add Xvfb, AppArmor, seed profile, and scratch workspace steps**

Insert after "Setup E2E Test Environment", before "Prove the build is the branch":

```yaml
      - name: Setup Xvfb
        uses: ./.github/actions/setup-xvfb

      - name: Alter AppArmor restrictions
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

      - name: Write seed profile and scratch workspace
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p /tmp/positron-seed/User
          echo '{}' > /tmp/positron-seed/User/settings.json
          mkdir -p /tmp/exploratory-workspace
          echo "# scratch" > /tmp/exploratory-workspace/README.md
```

- [ ] **Step 2: Add the launch step**

`launch.sh` prints exactly one JSON object with `pid`, `cdpPort`, `runDir`, and
`logFile`. Launcher arguments go BEFORE the `--`; app arguments go after. Putting
`--source-user-data-dir` after the `--` silently copies the real
`~/.positron-dev` profile instead of the seed.

`--password-store=basic` is not optional: the container has no OS keyring, and
without it Electron opens a modal that intercepts all input and looks exactly
like a product hang.

```yaml
      - name: Launch Positron
        id: launch
        shell: bash
        env:
          POSITRON_PY_VER_SEL: "3.10.12"
          POSITRON_R_VER_SEL: 4.5.2
          POSITRON_HIDDEN_PY: "3.12.10 (Conda)"
          POSITRON_HIDDEN_R: 4.4.1
        run: |
          set -euo pipefail
          LAUNCH_JSON=$(.claude/skills/drive-positron/scripts/launch.sh \
            --source-user-data-dir /tmp/positron-seed -- \
            --folder-uri file:///tmp/exploratory-workspace \
            --log debug \
            --no-sandbox \
            --disable-dev-shm-usage \
            --use-gl=swiftshader \
            --enable-unsafe-swiftshader \
            --disable-gpu-compositing \
            --password-store=basic)
          echo "$LAUNCH_JSON"
          echo "CDP_PORT=$(echo "$LAUNCH_JSON" | jq -r .cdpPort)" >> "$GITHUB_ENV"
          echo "RUN_DIR=$(echo "$LAUNCH_JSON" | jq -r .runDir)" >> "$GITHUB_ENV"
          echo "POSITRON_LOG=$(echo "$LAUNCH_JSON" | jq -r .logFile)" >> "$GITHUB_ENV"
```

- [ ] **Step 3: Add the attach-and-drive proof step**

Every `npx @playwright/cli` call must run from the repository root; from
anywhere else `npx` installs its own copy and reports the session as not open.

```yaml
      - name: Prove CDP attach and drive one action
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p /tmp/launch-proof
          npx @playwright/cli -s=positron attach --cdp=http://127.0.0.1:"$CDP_PORT"
          npx @playwright/cli -s=positron resize 1600 1100
          TITLE=$(npx @playwright/cli -s=positron eval '(() => document.title)()')
          echo "document.title = $TITLE"
          npx @playwright/cli -s=positron snapshot > /tmp/launch-proof/snapshot.txt
          npx @playwright/cli -s=positron screenshot --filename=/tmp/launch-proof/01-workbench.png
          test -s /tmp/launch-proof/01-workbench.png || { echo "screenshot empty"; exit 1; }
          grep -qi positron /tmp/launch-proof/snapshot.txt || { echo "snapshot does not look like Positron"; exit 1; }

      - name: Upload launch proof
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: exploratory-launch-proof
          path: |
            /tmp/launch-proof
            ${{ env.POSITRON_LOG }}
          if-no-files-found: warn
```

- [ ] **Step 4: Commit and open a PR**

```bash
git checkout -b midleman/exploratory-ci-launch
git add .github/workflows/pr-exploratory-test.yml
git commit -m "ci: launch Positron under Xvfb and prove CDP attach"
```

- [ ] **Step 5: Merge, dispatch, and verify the exit criteria**

Run: `gh workflow run pr-exploratory-test.yml --ref main -f ref=<your-branch>`

All three must hold before this task is done:
1. The job succeeds and `launch.sh` printed a `cdpPort`.
2. `document.title` printed something, and the snapshot grep passed -- a driven action landed.
3. `01-workbench.png` is downloadable from the `exploratory-launch-proof` artifact and shows the workbench, not a dialog.

A process that merely starts is NOT done. If the app hangs, download the
artifact and read `$POSITRON_LOG` first -- a keyring or workspace-trust modal is
the most likely cause and both show up there.

---

### Task 3: The agent harness

**Files:**
- Create: `.github/actions/pr-exploratory-test/action.yml`
- Create: `.github/actions/pr-exploratory-test/package.json`
- Create: `.github/actions/pr-exploratory-test/package-lock.json` (generated)
- Create: `.github/actions/pr-exploratory-test/lib.mjs`
- Create: `.github/actions/pr-exploratory-test/lib.test.mjs`
- Create: `.github/actions/pr-exploratory-test/run.mjs`
- Create: `.claude/skills/exploratory-testing/SKILL.md`
- Modify: `.github/workflows/pr-exploratory-test.yml`

**Interfaces:**
- Consumes: `CDP_PORT`, `RUN_DIR` from Task 2; the compiled checkout.
- Produces: `lib.mjs` exports `pickReport(messages: string[]) -> string | null`,
  `buildCostRecord(resultMessage: object) -> object`, and
  `renderCostFooter(cost: object) -> string`. `run.mjs` writes
  `$WORK_DIR/report.md` and `$WORK_DIR/cost.json`, and appends to
  `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 1: Check in the v1 skill with the `Type` column**

Copy `~/.claude/skills/exploratory-testing/SKILL.md` to
`.claude/skills/exploratory-testing/SKILL.md` verbatim, then make exactly two
edits.

Replace the triage table block:

```
| # | Finding | Impact | Caused by change |
|---|---------|--------|------------------|
| 1 | <short claim> | <how often, how bad, in a phrase> | yes |
```

with:

```
| # | Finding | Type | Impact | Caused by change |
|---|---------|------|--------|------------------|
| 1 | <short claim> | regression | <how often, how bad, in a phrase> | yes |
```

And immediately after the paragraph beginning "Impact is a phrase, not a
scale", insert:

```
`Type` is `regression`, `bug`, or `papercut`. A `regression` is behavior that
used to work and is now broken. A `bug` is new or changed behavior that never
worked correctly. A `papercut` is a pre-existing rough edge the change neither
introduced nor worsened. It is a different axis from `Caused by change`: a bug
the change caused is not necessarily a regression.
```

Do not change anything else. The file is the contract shared with local runs.

- [ ] **Step 2: Write the failing unit tests**

Create `.github/actions/pr-exploratory-test/lib.test.mjs`:

```js
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReport, buildCostRecord, renderCostFooter } from './lib.mjs';

test('pickReport returns the last message containing a triage table', () => {
	const messages = ['thinking out loud', '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | x | bug |'];
	assert.match(pickReport(messages), /Finding/);
});

test('pickReport returns null when no message looks like a report', () => {
	assert.equal(pickReport(['hello', 'still working']), null);
});

test('pickReport prefers the latest report when several qualify', () => {
	const messages = [
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | first | bug |',
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | second | bug |',
	];
	assert.match(pickReport(messages), /second/);
});

test('buildCostRecord extracts the fields the spec names', () => {
	const record = buildCostRecord({
		type: 'result',
		total_cost_usd: 1.2345,
		num_turns: 87,
		duration_ms: 1500000,
		usage: { input_tokens: 10, output_tokens: 20 },
	});
	assert.equal(record.total_cost_usd, 1.2345);
	assert.equal(record.num_turns, 87);
	assert.equal(record.duration_ms, 1500000);
	assert.equal(record.input_tokens, 10);
	assert.equal(record.output_tokens, 20);
});

test('buildCostRecord tolerates a result message missing usage', () => {
	const record = buildCostRecord({ type: 'result' });
	assert.equal(record.input_tokens, null);
	assert.equal(record.total_cost_usd, null);
});

test('renderCostFooter reports cost, turns against the cap, and wall clock', () => {
	const footer = renderCostFooter({ total_cost_usd: 1.2, num_turns: 87, duration_ms: 1500000 }, 200);
	assert.match(footer, /\$1\.20/);
	assert.match(footer, /87\/200 turns/);
	assert.match(footer, /25m/);
});

test('renderCostFooter degrades gracefully with no result message', () => {
	const footer = renderCostFooter({ total_cost_usd: null, num_turns: null, duration_ms: null }, 200);
	assert.match(footer, /unknown/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test .github/actions/pr-exploratory-test/lib.test.mjs`
Expected: FAIL with `Cannot find module` for `./lib.mjs`.

- [ ] **Step 4: Write `lib.mjs`**

```js
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for run.mjs, kept separate so they can be unit tested without
// the Agent SDK or a live container.

/** Pick the latest assistant message that looks like the report. */
export function pickReport(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (/\|\s*#\s*\|\s*Finding\s*\|/.test(messages[i])) {
			return messages[i];
		}
	}
	return null;
}

/** Flatten the SDK result message into the record written to cost.json. */
export function buildCostRecord(message) {
	return {
		total_cost_usd: message?.total_cost_usd ?? null,
		num_turns: message?.num_turns ?? null,
		duration_ms: message?.duration_ms ?? null,
		input_tokens: message?.usage?.input_tokens ?? null,
		output_tokens: message?.usage?.output_tokens ?? null,
	};
}

/** One-line footer for the step summary. */
export function renderCostFooter(cost, maxTurns) {
	const dollars = typeof cost.total_cost_usd === 'number'
		? `$${cost.total_cost_usd.toFixed(2)}`
		: 'unknown cost';
	const turns = typeof cost.num_turns === 'number'
		? `${cost.num_turns}/${maxTurns} turns`
		: 'unknown turns';
	const clock = typeof cost.duration_ms === 'number'
		? `${Math.round(cost.duration_ms / 60000)}m`
		: 'unknown duration';
	return `_${dollars} | ${turns} | ${clock}_`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .github/actions/pr-exploratory-test/lib.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write `package.json` and generate the lockfile**

`npm ci` in the action requires a committed lockfile. Generate it, do not hand-write it.

```json
{
	"name": "pr-exploratory-test-action",
	"private": true,
	"type": "module",
	"description": "GH composite action that runs the exploratory-testing skill against a live Positron via the Claude Agent SDK.",
	"dependencies": {
		"@anthropic-ai/claude-agent-sdk": "^0.2.128"
	}
}
```

Run: `cd .github/actions/pr-exploratory-test && npm install --package-lock-only --no-audit --no-fund`
Expected: `package-lock.json` appears.

- [ ] **Step 7: Write `run.mjs`**

Three things the CI tail must override in v1's SKILL.md, and no more: do not
delegate, write to `$WORK_DIR`, do not clean up. `drive-positron`'s SKILL.md is
read from disk by the agent, not inlined -- it is large and would be re-sent
every turn.

```js
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to run the exploratory-testing skill against a
// Positron instance already launched and attached by the workflow.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickReport, buildCostRecord, renderCostFooter } from './lib.mjs';

const WORK_DIR = mustEnv('WORK_DIR');
const REPO_ROOT = mustEnv('REPO_ROOT');
const SKILL_PATH = mustEnv('SKILL_PATH');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const BRANCH = mustEnv('BRANCH');
const DIFF_STAT = process.env.DIFF_STAT || '(no diff stat provided)';
const CDP_PORT = mustEnv('CDP_PORT');
const MODEL = process.env.MODEL || 'opus';
const MAX_TURNS = Number(process.env.MAX_TURNS || '200');
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return v;
}

const CI_TAIL = `

---

# CI run

You are running inside a GitHub Actions container. Three overrides to the skill above:

1. **You are the tester.** Ignore "Run it in a subagent". Do not delegate; do the exploring yourself.
2. **Write the run directory to \`${WORK_DIR}\`**, not to any path under \`~/.claude\`. Put \`report.md\` and \`actions.log\` directly in it and screenshots in \`${WORK_DIR}/shots/\`.
3. **Do NOT clean up.** Do not run \`stop.sh\`, do not close the Playwright session, do not remove the run directory. The container is destroyed when the job ends, and cleanup would delete the screenshots before they are uploaded.

Positron is already launched and a Playwright session named \`positron\` is already attached to it on CDP port ${CDP_PORT}. Do not launch it again. Drive it from the repository root at \`${REPO_ROOT}\` with:

\`\`\`bash
npx @playwright/cli -s=positron snapshot
\`\`\`

Read \`${REPO_ROOT}/.claude/skills/drive-positron/SKILL.md\` for the full command surface before driving.
`;

async function main() {
	mkdirSync(join(WORK_DIR, 'shots'), { recursive: true });

	const systemPrompt = readFileSync(SKILL_PATH, 'utf8') + CI_TAIL;

	const userPrompt = [
		'# Brief',
		'',
		`Checkout: \`${REPO_ROOT}\``,
		`Branch under test: \`${BRANCH}\``,
		`Head: \`${HEAD_SHA}\``,
		`Base: \`${BASE_SHA}\``,
		`Run directory: \`${WORK_DIR}\``,
		'',
		'## What changed',
		'',
		'```',
		DIFF_STAT,
		'```',
		'',
		`See the full diff with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA}\`.`,
		'',
		'## Your task',
		'',
		'Read the diff to work out what the change is meant to do as a user would describe it, and what its blast radius is. Then explore that, as a user, and report genuine problems.',
		'',
		'Prove the build is the branch before exploring, as the skill requires: grep the compiled output under `out/` for a string the diff introduces, and record the check in Run setup.',
		'',
		'Write the report to `report.md` in the run directory. Return a two or three line summary and nothing else.',
	].join('\n');

	console.log(`[exploratory] WORK_DIR=${WORK_DIR} model=${MODEL} maxTurns=${MAX_TURNS}`);
	console.log(`[exploratory] user prompt:\n${userPrompt}`);

	const assistantMessages = [];
	let cost = buildCostRecord(null);
	let turnCount = 0;

	for await (const message of query({
		prompt: userPrompt,
		options: {
			model: MODEL,
			cwd: REPO_ROOT,
			systemPrompt,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
			permissionMode: 'bypassPermissions',
			maxTurns: MAX_TURNS,
			thinking: { type: 'disabled' },
			...(CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CODE_PATH } : {}),
		},
	})) {
		if (message.type === 'assistant') {
			turnCount++;
			const content = message.message?.content || [];
			const textBlocks = content.filter(b => b.type === 'text').map(b => b.text);
			const toolUses = content.filter(b => b.type === 'tool_use').map(b => `${b.name}(${JSON.stringify(b.input).slice(0, 200)})`);
			if (textBlocks.length) {
				assistantMessages.push(textBlocks.join('\n'));
			}
			if (toolUses.length) {
				console.log(`[turn ${turnCount}] ${toolUses.join(' | ')}`);
			}
		} else if (message.type === 'result') {
			cost = buildCostRecord(message);
			console.log(`[exploratory] result: ${JSON.stringify(cost)}`);
		}
	}

	writeFileSync(join(WORK_DIR, 'cost.json'), JSON.stringify(cost, null, 2));

	const footer = renderCostFooter(cost, MAX_TURNS);
	const report = pickReport(assistantMessages);
	const partial = typeof cost.num_turns === 'number' && cost.num_turns >= MAX_TURNS;

	let summary;
	if (report) {
		summary = `## Exploratory test\n\n${report}\n\n${footer}\n`;
		writeFileSync(join(WORK_DIR, 'report.md'), report);
	} else if (partial) {
		summary = `## Exploratory test: partial run\n\nThe agent hit the ${MAX_TURNS}-turn cap before writing a report. \`actions.log\` and any screenshots captured so far are in the artifact.\n\n${footer}\n`;
	} else {
		summary = `## Exploratory test: no report\n\nThe agent produced no report. Check the action logs.\n\n${footer}\n`;
	}

	if (STEP_SUMMARY) {
		appendFileSync(STEP_SUMMARY, summary);
	}
	console.log(summary);

	if (!report) {
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
```

- [ ] **Step 8: Write `action.yml`**

```yaml
name: "PR Exploratory Test"
description: "Run the exploratory-testing skill against a launched Positron via the Claude Agent SDK."
inputs:
  anthropic-api-key:
    description: "Anthropic API key (resolved from 1Password by the caller)"
    required: true
  work-dir:
    description: "Run directory for report.md, actions.log, shots/ and cost.json"
    required: true
  repo-root:
    description: "Repository root the agent drives from"
    required: false
    default: ""
  cdp-port:
    description: "CDP port of the already-launched Positron"
    required: true
  branch:
    description: "Branch under test"
    required: true
  diff-stat:
    description: "Output of git diff --stat between base and head"
    required: false
    default: ""
  base-sha:
    description: "Diff base SHA"
    required: true
  head-sha:
    description: "Head SHA"
    required: true
  model:
    description: "Anthropic model identifier (a tier alias like 'opus' always resolves to the latest)"
    required: false
    default: "opus"
  max-turns:
    description: "Maximum agent turns (cost guard)"
    required: false
    default: "200"
runs:
  using: composite
  steps:
    - name: Set up Node
      uses: actions/setup-node@v6
      with:
        node-version: "20"

    - name: Install action dependencies
      shell: bash
      working-directory: ${{ github.action_path }}
      run: npm ci --no-audit --no-fund

    - name: Install Claude Code CLI
      # Workaround for an Agent SDK bug that resolves the musl-variant binary
      # before the glibc one on Linux runners (claude-agent-sdk-typescript#296).
      shell: bash
      run: |
        npm install -g @anthropic-ai/claude-code
        echo "CLAUDE_CODE_PATH=$(which claude)" >> "$GITHUB_ENV"
        claude --version

    - name: Explore with Claude Agent SDK
      shell: bash
      working-directory: ${{ github.action_path }}
      env:
        ANTHROPIC_API_KEY: ${{ inputs.anthropic-api-key }}
        WORK_DIR: ${{ inputs.work-dir }}
        REPO_ROOT: ${{ inputs.repo-root || github.workspace }}
        SKILL_PATH: ${{ inputs.repo-root || github.workspace }}/.claude/skills/exploratory-testing/SKILL.md
        CDP_PORT: ${{ inputs.cdp-port }}
        BRANCH: ${{ inputs.branch }}
        DIFF_STAT: ${{ inputs.diff-stat }}
        BASE_SHA: ${{ inputs.base-sha }}
        HEAD_SHA: ${{ inputs.head-sha }}
        MODEL: ${{ inputs.model }}
        MAX_TURNS: ${{ inputs.max-turns }}
      run: node run.mjs
```

- [ ] **Step 9: Wire the action into the workflow**

Replace the "Prove CDP attach and drive one action" and "Upload launch proof"
steps with the real run. Keep the attach step -- the agent is told the session
already exists.

```yaml
      - name: Attach Playwright
        shell: bash
        run: |
          set -euo pipefail
          npx @playwright/cli -s=positron attach --cdp=http://127.0.0.1:"$CDP_PORT"
          npx @playwright/cli -s=positron resize 1600 1100

      - name: Allocate run directory
        shell: bash
        run: |
          set -euo pipefail
          echo "EXPLORE_DIR=/tmp/exploratory-run" >> "$GITHUB_ENV"
          mkdir -p /tmp/exploratory-run/shots

      - name: Explore
        uses: ./.github/actions/pr-exploratory-test
        with:
          anthropic-api-key: ${{ env.ANTHROPIC_KEY }}
          work-dir: ${{ env.EXPLORE_DIR }}
          cdp-port: ${{ env.CDP_PORT }}
          branch: ${{ inputs.ref }}
          diff-stat: ${{ steps.base.outputs.diff_stat }}
          base-sha: ${{ steps.base.outputs.base }}
          head-sha: ${{ steps.base.outputs.head }}

      - name: Upload run directory
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: exploratory-run
          path: |
            ${{ env.EXPLORE_DIR }}
            ${{ env.POSITRON_LOG }}
          if-no-files-found: warn
```

Add the 1Password step immediately after the checkout step in the workflow:

```yaml
      - name: Load secret
        uses: 1password/load-secrets-action@v5
        with:
          export-env: true
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
          ANTHROPIC_KEY: "op://Positron/Anthropic/credential"
```

Also export the diff stat for the prompt by extending the "Resolve diff base" step:

```yaml
          {
            echo "diff_stat<<DIFFEOF"
            git --no-pager diff "$BASE"...HEAD --stat
            echo "DIFFEOF"
          } >> "$GITHUB_OUTPUT"
```

The `diff-stat` input added in Step 8 carries this into `run.mjs`.

- [ ] **Step 10: Run the unit tests and precommit**

Run: `node --test .github/actions/pr-exploratory-test/lib.test.mjs`
Expected: PASS, 7 tests.

Run: `npm run precommit -- .github/actions/pr-exploratory-test/run.mjs .github/actions/pr-exploratory-test/lib.mjs .github/actions/pr-exploratory-test/lib.test.mjs`
Expected: PASS.

- [ ] **Step 11: Commit and open a PR**

```bash
git checkout -b midleman/exploratory-ci-harness
git add .github/actions/pr-exploratory-test/action.yml \
        .github/actions/pr-exploratory-test/package.json \
        .github/actions/pr-exploratory-test/package-lock.json \
        .github/actions/pr-exploratory-test/lib.mjs \
        .github/actions/pr-exploratory-test/lib.test.mjs \
        .github/actions/pr-exploratory-test/run.mjs \
        .claude/skills/exploratory-testing/SKILL.md \
        .github/workflows/pr-exploratory-test.yml
git commit -m "ci: run the exploratory-testing skill via the Agent SDK"
```

- [ ] **Step 12: Merge, dispatch, verify end to end**

Run: `gh workflow run pr-exploratory-test.yml --ref main -f ref=<a-branch-with-a-real-ui-change>`

Expected: the step summary holds a triage table with a `Type` column and a cost
footer. The `exploratory-run` artifact contains `report.md`, `cost.json`,
`actions.log`, and a non-empty `shots/`.

Record the `num_turns` from `cost.json`. Task 5 needs it.

---

### Task 4: S3 upload and CDN-linked screenshots

**Files:**
- Modify: `.github/actions/upload-report-to-s3/action.yml`
- Modify: `.github/workflows/pr-exploratory-test.yml`

**Interfaces:**
- Consumes: `EXPLORE_DIR` from Task 3.
- Produces: `REPORT_DIR` in the job env and the run directory published at
  `https://d38p2avprg8il3.cloudfront.net/$REPORT_DIR/`.

- [ ] **Step 1: Add an optional `source-dir` input to the S3 action**

Every existing caller must keep its current behavior, so the default is the
current hardcoded path.

In `.github/actions/upload-report-to-s3/action.yml`, add to `inputs:`:

```yaml
  source-dir:
    description: "Directory to upload. Defaults to the Playwright report directory."
    required: false
    default: "playwright-report"
```

and change the `aws s3 cp` line from:

```bash
        aws s3 cp playwright-report/. s3://positron-test-reports/${{ inputs.report-dir }} --recursive
```

to:

```bash
        aws s3 cp "${{ inputs.source-dir }}/." s3://positron-test-reports/${{ inputs.report-dir }} --recursive
```

- [ ] **Step 2: Verify no existing caller changes behavior**

Run: `grep -rn "upload-report-to-s3" .github/workflows/ .github/actions/`
Expected: every hit passes only `role-to-assume`, `report-dir`, and possibly
`working-directory`. None passes `source-dir`, so all keep uploading
`playwright-report/.`.

- [ ] **Step 3: Allocate `REPORT_DIR` in the workflow**

`gen-report-dir` already exists and is used unmodified, but two of its behaviors
matter here. It appends its own "Playwright Report" line to the step summary
unless you skip it, and its `REPORT_URL` output is hardcoded to end in
`/index.html`, which this run directory does not contain. Take `REPORT_DIR` and
build the link yourself.

Replace the "Allocate run directory" step from Task 3 with:

```yaml
      - name: Allocate report dir
        uses: ./.github/actions/gen-report-dir
        with:
          identifier: exploratory
          skip-summary: "true"

      - name: Allocate run directory
        shell: bash
        run: |
          set -euo pipefail
          echo "EXPLORE_DIR=/tmp/exploratory-run" >> "$GITHUB_ENV"
          echo "REPORT_BASE_URL=https://d38p2avprg8il3.cloudfront.net/$REPORT_DIR" >> "$GITHUB_ENV"
          mkdir -p /tmp/exploratory-run/shots
```

- [ ] **Step 4: Pass the CDN base into the agent so shots are linked, not pathed**

In `.github/actions/pr-exploratory-test/action.yml`, add to `inputs:`:

```yaml
  report-base-url:
    description: "Public CDN base URL the run directory is published under"
    required: false
    default: ""
```

and to the `env:` of the "Explore with Claude Agent SDK" step:

```yaml
        REPORT_BASE_URL: ${{ inputs.report-base-url }}
```

In the workflow's "Explore" step, add:

```yaml
          report-base-url: ${{ env.REPORT_BASE_URL }}
```

In `run.mjs`, read it alongside the other env vars:

```js
const REPORT_BASE_URL = process.env.REPORT_BASE_URL || '';
```

and append this item to `CI_TAIL` (it is already a template literal, so the
interpolation works as written):

```js
4. **Link screenshots with their public URL.** The run directory is published at \`${REPORT_BASE_URL}\`. Where the skill says to cite a shot as \`[shots/<file>](shots/<file>)\`, write \`[shots/<file>](${REPORT_BASE_URL}/shots/<file>)\` instead, and embed with \`![](${REPORT_BASE_URL}/shots/<file>)\`. A relative path is unreachable to anyone reading the report outside this container.
```

If `REPORT_BASE_URL` is empty the links degrade to relative paths, which is the
Task 3 behavior -- acceptable, not silently broken.

- [ ] **Step 5: Add the upload step**

Insert before "Upload run directory":

```yaml
      - name: Upload run directory to S3
        if: always()
        continue-on-error: true
        uses: ./.github/actions/upload-report-to-s3
        with:
          role-to-assume: ${{ secrets.AWS_TEST_REPORTS_ROLE }}
          report-dir: ${{ env.REPORT_DIR }}
          source-dir: ${{ env.EXPLORE_DIR }}
```

`continue-on-error: true` means a failed upload leaves the artifact as the only
copy rather than failing the run. The report's CDN links will 404 in that case;
the artifact still carries the shots.

- [ ] **Step 6: Commit and open a PR**

```bash
git checkout -b midleman/exploratory-ci-s3
git add .github/actions/upload-report-to-s3/action.yml \
        .github/actions/pr-exploratory-test/action.yml \
        .github/actions/pr-exploratory-test/run.mjs \
        .github/workflows/pr-exploratory-test.yml
git commit -m "ci: publish exploratory run directory to S3 with CDN-linked shots"
```

- [ ] **Step 7: Merge, dispatch, verify the links resolve**

Run: `gh workflow run pr-exploratory-test.yml --ref main -f ref=<your-branch>`

Then take a shot URL out of the step summary and confirm it serves:

Run: `curl -sS -o /dev/null -w '%{http_code}\n' "<a shots URL from the report>"`
Expected: `200`. A `404` means either the upload failed or the report emitted a
relative path -- check the upload step's log first.

Also confirm an unrelated e2e run still uploads its Playwright report normally,
proving the `source-dir` default did not regress existing callers.

---

### Task 5: Calibrate `maxTurns`

**Files:**
- Modify: `.github/actions/pr-exploratory-test/action.yml`

**Interfaces:**
- Consumes: `cost.json` from several completed runs.
- Produces: a `max-turns` default backed by measurement rather than estimate.

200 is an estimate extrapolated from local `actions.log` counts of 19, 25, 43,
and 48 logged actions. `num_turns` in `cost.json` is the real number.

- [ ] **Step 1: Collect data from at least five real runs**

Dispatch against five branches with genuine UI changes, ideally of differing
size. For each, download the artifact and record `num_turns`, `total_cost_usd`,
and `duration_ms` from `cost.json`.

```bash
for id in <run-ids>; do
  gh run download "$id" -n exploratory-run -D "/tmp/cal/$id"
  echo "$id $(jq -c '{num_turns,total_cost_usd,duration_ms}' "/tmp/cal/$id/cost.json")"
done
```

- [ ] **Step 2: Decide the new cap**

Set the default to roughly 1.5x the highest observed `num_turns`, rounded to a
round number. If any run reported `num_turns >= 200` it was truncated, and the
real distribution is unknown -- raise the cap and collect again before settling.

Record the observed numbers in the spec's "Turn budget" section, replacing the
local-only action counts.

- [ ] **Step 3: Commit**

```bash
git checkout -b midleman/exploratory-ci-turn-cap
git add .github/actions/pr-exploratory-test/action.yml \
        docs/design/2026-09-21-pr-exploratory-testing-design.md
git commit -m "ci: set exploratory-test turn cap from measured run data"
```

---

## What phase 1 does NOT include

Listed so a reviewer does not flag them as gaps:

- The `issue_comment` / `/test` trigger, the `gate` job, the membership check,
  PR comments, and reactions. All phase 2.
- A warm second launch via `reseed.sh`. Deferred in the spec as an open question.
- A focus argument (`/test notebooks`). Not in v1.
- Aggregating cost anywhere beyond `cost.json` and the step summary.
