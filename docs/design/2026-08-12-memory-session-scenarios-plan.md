# Memory session scenarios and CI matrix implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `session-python` and `session-r` memory scenarios alongside the shipped `idle` one, and split the nightly workflow into a per-scenario job matrix.

**Architecture:** The collector, labeling rules, report, and payload all stay as they are. Three changes make room for more scenarios: `scenario` widens from the literal `'idle'` to a union that is threaded through the snapshot, report, and payload; the shared spec body moves into a factory so each scenario is a short spec file; and the workflow becomes a matrix keyed on `MEMORY_SCENARIO`. Session scenarios start their session explicitly through the sessions page object rather than letting an interpreter auto-start.

**Tech Stack:** TypeScript, Playwright (e2e, `e2e-electron` project), Vitest (unit), GitHub Actions.

Design: [2026-08-12-memory-scenario-selection-design.md](2026-08-12-memory-scenario-selection-design.md)
Issues: [#15491](https://github.com/posit-dev/positron/issues/15491) (scenarios), [#15001](https://github.com/posit-dev/positron/issues/15001) (epic)

## Global Constraints

- Tabs for indentation in TypeScript, never spaces.
- ASCII only. No em-dashes, en-dashes, smart quotes, or other non-ASCII punctuation.
- Copyright header on every new file, `Copyright (C) 2026 Posit Software, PBC.`
- Never run `npx tsc` or `tsc --noEmit` against `src/tsconfig.json`. For type errors in `*.vitest.ts`, run `npm run test:positron:check-ts`.
- Unit tests are Vitest, `*.vitest.ts`, colocated with the module. No new `*.test.ts` under `src/vs/`.
- New e2e specs go in `test/e2e/tests/performance/` and are collected only by `test-memory-metrics.yml`. A memory spec that leaks into the ordinary lanes will run on every PR.
- `payload_version` stays `1`. Widening the `scenario` union is backward compatible; changing the payload shape is not, and is out of scope.
- Do not use `git add -A`. Stage explicit paths: the `node_modules` symlink in this worktree gets tracked otherwise.

## Deviation from #15491

That issue says the work is "a new scenario module plus the settings fixture to let interpreters start." This plan does the opposite: session scenarios keep `interpreters.startupBehavior: manual` from `settingsMemory.json` and start the session explicitly with `sessions.startAndSkipMetadata()`.

Reasons: an explicitly started session is deterministic and reports Ready at a known point, whereas auto-start has a known re-drive gap where discovery completes without the start being re-driven ([#14991](https://github.com/posit-dev/positron/issues/14991)); and `session-python` needs Python running and R not, which auto-start does not let us control. Task 6 updates the issue to match.

## File Structure

| File | Responsibility |
| --- | --- |
| `test/e2e/utils/memory/types.ts` | modify: `MemoryScenario` union, `MemorySnapshot.scenario` widened |
| `test/e2e/utils/memory/scenarios.ts` | create: the scenario vocabulary, its spec-file map, and the env gating predicate. Pure, no I/O, so both `playwright.config.ts` and the fixtures can import it |
| `test/e2e/utils/memory/scenarios.vitest.ts` | create: unit tests for the above |
| `test/e2e/utils/memory/snapshot.ts` | modify: `captureSnapshot` takes a scenario and records it |
| `test/e2e/utils/memory/render.ts` | modify: report titles name the scenario |
| `test/e2e/utils/memory/publish.ts` | modify: payload and baseline query carry the scenario |
| `test/e2e/tests/performance/memory-scenario.ts` | create: the shared measure and report spec bodies. Not `*.test.ts`, so Playwright does not collect it |
| `test/e2e/tests/performance/memory-idle.test.ts` | modify: becomes a call into the factory |
| `test/e2e/tests/performance/memory-session-python.test.ts` | create |
| `test/e2e/tests/performance/memory-session-r.test.ts` | create |
| `test/e2e/fixtures/test-setup/shared-utils.ts` | modify: pre-launch settings gate on any memory scenario |
| `test/e2e/fixtures/test-setup/options.fixtures.ts` | modify: dedicated extensions dir for any memory scenario |
| `playwright.config.ts` | modify: collect only the running scenario's spec |
| `.github/workflows/test-memory-metrics.yml` | modify: job matrix over scenarios |

---

### Task 0: Confirm the container resolves both interpreters

The idle scenario never starts a kernel, so `test-memory-metrics.yml` sets `POSITRON_PY_VER_SEL` and `POSITRON_R_VER_SEL` only to satisfy the `envVars` fixture. Nothing has ever proved those versions exist in `ghcr.io/posit-dev/positron-ubuntu24:24.18.0`. Every task after this one assumes they do.

No code. This is a gate.

- [ ] **Step 1: Dispatch the current nightly workflow and read the interpreter inventory**

```bash
gh workflow run test-memory-metrics.yml -R posit-dev/positron --ref <this-branch>
```

Wait for it, then download the artifact and check which interpreters the image actually has:

```bash
gh run download <run-id> -R posit-dev/positron -n memory-report -D /tmp/memcheck
```

- [ ] **Step 2: Verify the versions the workflow declares are present**

The workflow declares `POSITRON_PY_VER_SEL: "3.10.12"` and `POSITRON_R_VER_SEL: 4.5.2`. Confirm both exist in the image:

```bash
docker run --rm --entrypoint bash ghcr.io/posit-dev/positron-ubuntu24:24.18.0 -c \
  'ls /usr/lib/R/ /opt/R 2>/dev/null; python3 --version; ls /root/.pyenv/versions 2>/dev/null'
```

Expected: a Python 3.10.12 and an R 4.5.2 are resolvable.

- [ ] **Step 3: Record the outcome and stop if it fails**

If either is missing, do not continue. Two known hazards in this image, both from prior debugging:
- `/root/.venv` wins interpreter selection in Docker, and include/exclude settings do not fix it ([#15039](https://github.com/posit-dev/positron/pull/15039)).
- Interpreter tests in the CI-arm container need `CI=true` plus `POSITRON_HIDDEN_PY` / `POSITRON_HIDDEN_R` set.

Report back with what the image has before writing any code. A missing interpreter changes Task 5 and Task 6 from "start a session" to "install an interpreter first," which is a different plan.

---

### Task 1: Widen `scenario` to a union and thread it through

**Files:**
- Create: `test/e2e/utils/memory/scenarios.ts`
- Create: `test/e2e/utils/memory/scenarios.vitest.ts`
- Modify: `test/e2e/utils/memory/types.ts:65`
- Modify: `test/e2e/utils/memory/snapshot.ts:154-184`
- Modify: `test/e2e/utils/memory/render.ts:207,349,357`
- Modify: `test/e2e/utils/memory/publish.ts:82,137,228,264`
- Test: `test/e2e/utils/memory/publish.vitest.ts`, `test/e2e/utils/memory/render.vitest.ts`

**Interfaces:**
- Produces: `MemoryScenario = 'idle' | 'session-python' | 'session-r'`; `MEMORY_SCENARIOS: readonly MemoryScenario[]`; `isMemoryScenario(value: string | undefined): value is MemoryScenario`; `captureSnapshot(input: { scenario: MemoryScenario; rootPid: number; buildRoot: string; userDataDir: string; launchIndex: number; extensions: ActivatedExtension[] })`; `fetchBaseline(scenario: MemoryScenario)`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test for the scenario vocabulary**

Create `test/e2e/utils/memory/scenarios.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isMemoryScenario, MEMORY_SCENARIOS } from './scenarios.js';

describe('isMemoryScenario', () => {
	test('accepts every scenario in the vocabulary', () => {
		for (const scenario of MEMORY_SCENARIOS) {
			expect(isMemoryScenario(scenario)).toBe(true);
		}
	});

	test('rejects an unset MEMORY_SCENARIO, which is the ordinary e2e lanes', () => {
		expect(isMemoryScenario(undefined)).toBe(false);
	});

	test('rejects a typo rather than silently measuring nothing', () => {
		expect(isMemoryScenario('session_python')).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: FAIL, cannot resolve `./scenarios.js`.

- [ ] **Step 3: Create the module**

Create `test/e2e/utils/memory/scenarios.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which app state a memory run measured. The dashboard keys one series per
 * scenario, so these strings are a published contract; renaming one splits its
 * history in two.
 */
export type MemoryScenario = 'idle' | 'session-python' | 'session-r';

export const MEMORY_SCENARIOS: readonly MemoryScenario[] = ['idle', 'session-python', 'session-r'];

/**
 * Whether MEMORY_SCENARIO names a real scenario. Unset means an ordinary e2e
 * lane, where none of the memory machinery should engage. A typo returns false
 * rather than throwing, and the spec's own quality gate fails the run instead:
 * config loading is the wrong place to die.
 */
export function isMemoryScenario(value: string | undefined): value is MemoryScenario {
	return value !== undefined && (MEMORY_SCENARIOS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point `MemorySnapshot` at the union**

In `test/e2e/utils/memory/types.ts`, add the import and widen the field:

```ts
import { MemoryScenario } from './scenarios.js';
```

Replace line 65, `scenario: 'idle';`, with:

```ts
	scenario: MemoryScenario;
```

- [ ] **Step 6: Write the failing test for the scenario reaching the payload**

In `test/e2e/utils/memory/publish.vitest.ts`, inside the `buildPayload` describe block, add:

```ts
	test('carries the snapshot scenario rather than assuming idle', () => {
		const payload = buildPayload([{ ...snapshot, scenario: 'session-r' }], meta);
		expect(payload.scenario).toBe('session-r');
	});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts -t 'carries the snapshot scenario'`
Expected: FAIL, received `'idle'`.

- [ ] **Step 8: Thread the scenario through `publish.ts`**

Add to the imports:

```ts
import { MemoryScenario } from './scenarios.js';
```

Line 82, in the `MemoryPayload` type, becomes:

```ts
	scenario: MemoryScenario;
```

Line 137, in `buildPayload`, becomes:

```ts
		scenario: snapshots[0].scenario,
```

`baselineToSnapshot` at line 223 cannot read the scenario off the response: `BaselineResponse` has no such field, and adding one would be a server-side contract change. Take it from the caller instead, which knows what it asked for. Change the signature and line 228:

```ts
export function baselineToSnapshot(body: BaselineResponse, scenario: MemoryScenario): MemorySnapshot | undefined {
	if (!body.found) {
		return undefined;
	}
	return {
		scenario,
```

Line 259, `fetchBaseline`, takes the scenario, uses it in the query, and passes it down:

```ts
export async function fetchBaseline(scenario: MemoryScenario): Promise<MemorySnapshot | undefined> {
	if (!publishingEnabled() || !CONNECT_API_KEY) {
		return undefined;
	}
	try {
		const response = await request(`${memoryUrl(PROD_API_URL)}/baseline?scenario=${scenario}&branch=main`, {
			method: 'GET',
			headers: { Authorization: `Key ${CONNECT_API_KEY}` }
		});
		if (response.statusCode >= 400) {
			return undefined;
		}
		return baselineToSnapshot(await response.body.json() as BaselineResponse, scenario);
```

The existing `baselineToSnapshot` tests in `publish.vitest.ts` call it with one argument and will fail to compile. Pass `'idle'` as the second argument in each, which preserves what they assert.

- [ ] **Step 9: Run the publish tests**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: PASS. Fix any call site the signature change broke.

- [ ] **Step 10: Write the failing test for the report naming its scenario**

In `test/e2e/utils/memory/render.vitest.ts`, add to the `renderMarkdown` describe block:

```ts
	test('names the scenario in the heading, so two reports cannot be confused', () => {
		const markdown = renderMarkdown([{ ...snapshot, scenario: 'session-python' }], null);
		expect(markdown).toContain('## Memory: session-python');
	});
```

If the local `snapshot` fixture in that file is named differently, use whatever it is called there.

- [ ] **Step 11: Run it to confirm it fails**

Run: `npx vitest run test/e2e/utils/memory/render.vitest.ts -t 'names the scenario in the heading'`
Expected: FAIL, the heading reads `## Memory: idle`.

- [ ] **Step 12: Use the scenario in the report**

In `test/e2e/utils/memory/render.ts`, line 207 becomes:

```ts
	const lines: string[] = [`## Memory: ${snapshots[0].scenario}`, ''];
```

Lines 349 and 357, the HTML title and `h1`, become the same interpolation:

```ts
	<title>Positron memory: ${snapshots[0].scenario}</title>
```

```ts
	<h1>Positron memory: ${snapshots[0].scenario}</h1>
```

Check the surrounding template literal is already a backtick string. If either line sits in a plain-quoted string, convert that string to a template literal.

- [ ] **Step 13: Take the scenario in `captureSnapshot`**

In `test/e2e/utils/memory/snapshot.ts`, add to the imports:

```ts
import { MemoryScenario } from './scenarios.js';
```

Line 154, the input type, gains a field:

```ts
export async function captureSnapshot(input: {
	scenario: MemoryScenario;
	rootPid: number;
	buildRoot: string;
	userDataDir: string;
	launchIndex: number;
	extensions: ActivatedExtension[];
}): Promise<MemorySnapshot> {
```

Line 175 stops hardcoding:

```ts
		scenario: input.scenario,
```

- [ ] **Step 14: Update the existing spec's call site so the suite still compiles**

In `test/e2e/tests/performance/memory-idle.test.ts`, add `scenario: 'idle',` as the first property of the `captureSnapshot` call at line 54, and change `fetchBaseline()` at line 129 to `fetchBaseline('idle')`. Task 3 replaces this file wholesale; this keeps the tree compiling in between.

- [ ] **Step 15: Run every memory unit test and the vitest type check**

Run: `npx vitest run test/e2e/utils/memory/`
Expected: PASS, all files.

Run: `npm run test:positron:check-ts`
Expected: no errors mentioning `test/e2e/utils/memory/`.

- [ ] **Step 16: Commit**

```bash
git add test/e2e/utils/memory/scenarios.ts test/e2e/utils/memory/scenarios.vitest.ts \
  test/e2e/utils/memory/types.ts test/e2e/utils/memory/snapshot.ts \
  test/e2e/utils/memory/render.ts test/e2e/utils/memory/publish.ts \
  test/e2e/utils/memory/publish.vitest.ts test/e2e/utils/memory/render.vitest.ts \
  test/e2e/tests/performance/memory-idle.test.ts
git commit -m "e2e: thread a scenario through the memory collector"
```

---

### Task 2: Gate the pre-launch fixtures on any memory scenario, not just idle

Both gates currently test `MEMORY_SCENARIO === 'idle'`. A session scenario needs the same dedicated extensions dir, for the same reason the comment on `options.fixtures.ts:39` gives: the shared dir accumulates whatever the suite installed, and one run counted two versions of ruff, 60 MB, with the version changing between launches. It also needs the same `settingsMemory.json`, because the session scenarios start their session explicitly and want auto-start off.

**Files:**
- Modify: `test/e2e/fixtures/test-setup/shared-utils.ts:78-90`
- Modify: `test/e2e/fixtures/test-setup/options.fixtures.ts:34-41`

**Interfaces:**
- Consumes: `isMemoryScenario` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Widen the settings gate**

In `test/e2e/fixtures/test-setup/shared-utils.ts`, add the import:

```ts
import { isMemoryScenario } from '../../utils/memory/scenarios.js';
```

Replace the comment and condition at lines 78 to 81 with:

```ts
	// 3. Merge memory-scenario settings for every memory scenario, not just idle.
	// Must be pre-launch: starting a runtime and then disabling it would leave it
	// running and counted. Session scenarios keep auto-start off too and start
	// their session explicitly, so the session they measure is the one they asked
	// for and reports Ready at a known point.
	if (isMemoryScenario(process.env.MEMORY_SCENARIO)) {
```

- [ ] **Step 2: Widen the extensions-dir gate**

In `test/e2e/fixtures/test-setup/options.fixtures.ts`, add the import:

```ts
import { isMemoryScenario } from '../../utils/memory/scenarios.js';
```

Replace lines 34 to 41 with:

```ts
		// Every memory scenario measures Positron and its bundled extensions, so
		// they get an extensions dir of their own. The shared one accumulates
		// whatever the suite installs, and that lands in the memory baseline as if
		// it were product memory: one CI run had two versions of ruff in it, 60 MB,
		// with the version changing between launches of the same run.
		const EXTENSIONS_PATH = isMemoryScenario(process.env.MEMORY_SCENARIO)
			? join(TEST_DATA_PATH, 'extensions-dir-memory')
			: join(TEST_DATA_PATH, 'extensions-dir');
```

- [ ] **Step 3: Verify the ordinary lanes are untouched**

With `MEMORY_SCENARIO` unset, `isMemoryScenario` returns false and both branches take the same path they did before. Confirm by running an unrelated spec locally:

```bash
unset BUILD MEMORY_SCENARIO
npx playwright test test/e2e/tests/extensions/bootstrap-extensions.test.ts --project e2e-electron
```

Expected: PASS, and the run uses `extensions-dir`, not `extensions-dir-memory`.

- [ ] **Step 4: Check types**

Run: `npm run build-check`
Expected: no new errors. These two files are e2e infra, not `src/vs`, so also confirm the e2e compile is clean:

```bash
npx tsc --noEmit -p test/e2e/tsconfig.json
```

Expected: no errors. This is the e2e project, not `src/tsconfig.json`, so it is safe to run.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/fixtures/test-setup/shared-utils.ts test/e2e/fixtures/test-setup/options.fixtures.ts
git commit -m "e2e: apply the memory pre-launch fixtures to every memory scenario"
```

---

### Task 3: Extract the shared spec body into a factory

`memory-idle.test.ts` holds the measure test and the report test. Copying both into each new scenario would triple a quality gate that took real work to get right. Move them into a factory that each scenario spec calls with its own name and preparation step.

**Files:**
- Create: `test/e2e/tests/performance/memory-scenario.ts`
- Modify: `test/e2e/tests/performance/memory-idle.test.ts`

**Interfaces:**
- Consumes: `MemoryScenario`, `captureSnapshot`, `fetchBaseline` from Task 1.
- Produces: `defineMemoryScenario(options: { scenario: MemoryScenario; prepare?: (fixtures: { app: Application; sessions: Sessions }) => Promise<void>; expectRoles?: ProcessRole[] }): void`.

- [ ] **Step 1: Create the factory**

Create `test/e2e/tests/performance/memory-scenario.ts`. Move the two `test.describe` blocks out of `memory-idle.test.ts` verbatim, wrapped in a function, with four changes: the scenario name is a parameter, `SNAPSHOT_DIR` is per scenario so a matrix job cannot read another scenario's files, `prepare` runs before the snapshot, and `expectRoles` asserts the scenario reached the state it claims.

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect, tags, test } from '../_test.setup';
import { Application, Sessions } from '../../infra';
import { readActivatedExtensions } from '../../utils/memory/extensions.js';
import { fetchBaseline, publishSnapshots } from '../../utils/memory/publish.js';
import { renderHtml, renderMarkdown } from '../../utils/memory/render.js';
import { captureSnapshot } from '../../utils/memory/snapshot.js';
import { MemoryScenario } from '../../utils/memory/scenarios.js';
import { MemorySnapshot, ProcessRole } from '../../utils/memory/types.js';

/**
 * Above the job's own `timeout-minutes`, so anything older than this cannot have
 * come from the run doing the rendering.
 */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

/**
 * Snapshots must outlive a single Playwright invocation: three separate
 * `npx playwright test` runs write here and a fourth reads them back.
 *
 * Deliberately NOT under `test-results/`. Playwright's outputDir defaults to
 * `test-results` and is wiped at the start of every run, so launch 1 would
 * delete launch 0's snapshot and the aggregation run would delete all three.
 * RUNNER_TEMP persists for the whole job.
 *
 * Per scenario, so a matrix job cannot read a sibling scenario's snapshots and
 * render a report that mixes two app states.
 */
function snapshotDir(scenario: MemoryScenario): string {
	return join(process.env.RUNNER_TEMP ?? '/tmp', `memory-snapshots-${scenario}`);
}

export function defineMemoryScenario(options: {
	scenario: MemoryScenario;
	/** Drives the app into the state being measured. Omitted for idle. */
	prepare?: (fixtures: { app: Application; sessions: Sessions }) => Promise<void>;
	/** Roles that must be present, proving the scenario reached its state. */
	expectRoles?: ProcessRole[];
}): void {
	const { scenario, prepare, expectRoles = [] } = options;
	const SNAPSHOT_DIR = snapshotDir(scenario);

	test.describe(`Memory: ${scenario}`, { tag: [tags.PERFORMANCE] }, () => {

		test(`Memory footprint of the Positron process tree: ${scenario}`, async function ({ app, sessions, logsPath }) {
			const buildRoot = process.env.BUILD;
			expect(buildRoot, 'BUILD must point at a Positron build; memory numbers from a dev build are meaningless').toBeTruthy();

			const mainPid = app.code.electronApp?.process().pid;
			expect(mainPid, 'no Electron main pid; this spec only runs against Electron').toBeTruthy();

			if (prepare) {
				await prepare({ app, sessions });
			}

			const extensions = await readActivatedExtensions({
				logsRoot: logsPath,
				extensionsDir: app.extensionsPath
			});

			const snapshot = await captureSnapshot({
				scenario,
				rootPid: mainPid!,
				buildRoot: buildRoot!,
				userDataDir: app.userDataPath,
				launchIndex: Number(process.env.MEMORY_LAUNCH_INDEX ?? 0),
				extensions
			});

			expect(snapshot.processes.length, 'no processes found in the tree').toBeGreaterThan(3);
			expect(snapshot.treeTotalPssBytes, 'total PSS was zero; smaps_rollup is probably unreadable').toBeGreaterThan(0);
			expect(snapshot.positronVersion, 'could not read positronVersion from the build\'s product.json').toBeTruthy();

			// Proves the scenario measured what it claims. Without this, a session
			// that failed to start would publish a number indistinguishable from a
			// healthy idle run and look like a 400 MB improvement.
			const roles = new Set(snapshot.processes.map(p => p.processRole));
			for (const role of expectRoles) {
				expect(roles, `scenario ${scenario} expected a ${role} process; the app never reached the state being measured`).toContain(role);
			}

			const namedShare = snapshot.processes.filter(p => p.labeled).length / snapshot.processes.length;
			expect(namedShare, 'Positron named too few processes; --status probably failed, and an unattributable total is worse than no data').toBeGreaterThan(0.5);

			const unlabeledBytes = snapshot.processes
				.filter(p => p.processRole === 'unlabeled')
				.reduce((sum, p) => sum + p.pssBytes, 0);
			expect(unlabeledBytes / snapshot.treeTotalPssBytes, 'more than a third of memory is unattributed; add rules to label.ts').toBeLessThan(0.34);

			expect(snapshot.extensions.length, 'no activated extensions found; findExtHostLog probably looked in the wrong logsRoot').toBeGreaterThan(0);

			mkdirSync(SNAPSHOT_DIR, { recursive: true });
			writeFileSync(join(SNAPSHOT_DIR, `memory-snapshot-${snapshot.launchIndex}.json`), JSON.stringify(snapshot, null, 2));

			console.log(`[memory] ${scenario} launch ${snapshot.launchIndex}: ${(snapshot.treeTotalPssBytes / 1048576).toFixed(1)} MB PSS across ${snapshot.processes.length} processes, settled in ${snapshot.settleMs} ms`);
		});
	});

	test.describe(`Memory report: ${scenario}`, { tag: [tags.PERFORMANCE] }, () => {

		test(`Render and publish the memory report: ${scenario}`, async function ({ }, testInfo) {
			const paths = [0, 1, 2].map(i => join(SNAPSHOT_DIR, `memory-snapshot-${i}.json`));
			const missing = paths.filter(path => !existsSync(path));
			expect(missing, `missing snapshot(s); a measure step probably failed: ${missing.join(', ')}`).toEqual([]);

			const snapshots: MemorySnapshot[] = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));

			const stale = snapshots.filter(({ capturedAt }) => {
				const ageMs = Date.now() - Date.parse(capturedAt);
				return !Number.isFinite(ageMs) || ageMs > MAX_SNAPSHOT_AGE_MS;
			});
			expect(stale.map(s => `launch ${s.launchIndex} at ${s.capturedAt}`),
				'stale snapshot(s); these are from an earlier run, so re-run the measure steps').toEqual([]);

			const versions = [...new Set(snapshots.map(s => s.positronVersion))];
			expect(versions, 'launches measured different builds; the median would be meaningless').toHaveLength(1);

			// A mixed set would render one heading over two app states.
			const scenarios = [...new Set(snapshots.map(s => s.scenario))];
			expect(scenarios, `snapshots span more than one scenario: ${scenarios.join(', ')}`).toEqual([scenario]);

			const baseline = await fetchBaseline(scenario);
			const markdown = renderMarkdown(snapshots, baseline);
			const html = renderHtml(snapshots, baseline);

			mkdirSync(SNAPSHOT_DIR, { recursive: true });
			const htmlPath = join(SNAPSHOT_DIR, 'memory-report.html');
			writeFileSync(htmlPath, html);
			await testInfo.attach('memory-report.html', { path: htmlPath, contentType: 'text/html' });
			if (process.env.GITHUB_STEP_SUMMARY) {
				appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
			}
			console.log(markdown);

			await publishSnapshots(snapshots, {
				runId: process.env.GITHUB_RUN_ID ?? 'local',
				commitSha: process.env.GITHUB_SHA ?? 'unknown',
				branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local',
				containerImage: process.env.MEMORY_CONTAINER_IMAGE ?? 'unknown'
			});
		});
	});
}
```

`Application` and `Sessions` come from `test/e2e/infra`, which is where `_test.setup.ts` itself gets them (see its line 15, and the fixture declarations at lines 613 and 648). This file is never imported by `playwright.config.ts`, so pulling in the harness types costs nothing.

- [ ] **Step 2: Rewrite the idle spec on top of the factory**

Replace the whole of `test/e2e/tests/performance/memory-idle.test.ts` with:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// No prepare step and no expected roles: idle is the app with nothing done to
// it, which is exactly what settingsMemory.json's manual startup behavior gives.
defineMemoryScenario({ scenario: 'idle' });
```

- [ ] **Step 3: Verify the test names still match what the workflow greps**

The workflow greps `'Idle memory footprint'` and `'Render and publish'`. The factory renames both tests, so those greps are now stale. Confirm the new names:

```bash
MEMORY_SCENARIO=idle npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --list
```

Expected: two tests, `Memory footprint of the Positron process tree: idle` and `Render and publish the memory report: idle`. Task 7 updates the workflow greps to match. Note the mismatch now so it is not a surprise later.

- [ ] **Step 4: Check the e2e project compiles**

Run: `npx tsc --noEmit -p test/e2e/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/tests/performance/memory-scenario.ts test/e2e/tests/performance/memory-idle.test.ts
git commit -m "e2e: extract the shared memory scenario spec body"
```

---

### Task 4: Collect only the running scenario's spec

`playwright.config.ts:111` ignores `memory-idle.test.ts` unless `MEMORY_SCENARIO === 'idle'`. Two new spec files land in the next tasks; without this change they are collected by every lane, including merge-to-main, and a session scenario would launch on every PR.

**Files:**
- Modify: `test/e2e/utils/memory/scenarios.ts`
- Modify: `test/e2e/utils/memory/scenarios.vitest.ts`
- Modify: `playwright.config.ts:108-111`

**Interfaces:**
- Produces: `memorySpecsToIgnore(scenario: string | undefined): string[]`.

- [ ] **Step 1: Write the failing test**

Add to `test/e2e/utils/memory/scenarios.vitest.ts`:

```ts
describe('memorySpecsToIgnore', () => {
	test('ignores every memory spec in an ordinary lane', () => {
		expect(memorySpecsToIgnore(undefined)).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts',
			'**/performance/memory-session-r.test.ts'
		]);
	});

	test('keeps only the running scenario, so one job measures one state', () => {
		expect(memorySpecsToIgnore('session-r')).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts'
		]);
	});

	test('ignores everything when the scenario is a typo, rather than running the wrong spec', () => {
		expect(memorySpecsToIgnore('session_r')).toHaveLength(3);
	});
});
```

Add `memorySpecsToIgnore` to the import at the top of the file.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: FAIL, `memorySpecsToIgnore` is not exported.

- [ ] **Step 3: Implement it**

Append to `test/e2e/utils/memory/scenarios.ts`:

```ts
/** The spec file that measures each scenario. */
const SPEC_BY_SCENARIO: Record<MemoryScenario, string> = {
	'idle': '**/performance/memory-idle.test.ts',
	'session-python': '**/performance/memory-session-python.test.ts',
	'session-r': '**/performance/memory-session-r.test.ts'
};

/**
 * Which memory specs a run must not collect. Every one of them except the
 * running scenario's, and all of them when no scenario is set.
 *
 * Ignored rather than skipped in-test because merge-to-main runs this lane
 * ungrepped, so a skip would report a permanently skipped row.
 */
export function memorySpecsToIgnore(scenario: string | undefined): string[] {
	return MEMORY_SCENARIOS
		.filter(candidate => candidate !== scenario)
		.map(candidate => SPEC_BY_SCENARIO[candidate]);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Use it in the config**

In `playwright.config.ts`, add to the imports:

```ts
import { memorySpecsToIgnore } from './test/e2e/utils/memory/scenarios';
```

Replace lines 108 to 111 with:

```ts
				// Set only by test-memory-metrics.yml, one scenario per matrix job.
				// Ignored rather than skipped in-test because merge-to-main runs this
				// lane ungrepped, so a skip would report a permanently skipped row.
				...memorySpecsToIgnore(process.env.MEMORY_SCENARIO),
```

- [ ] **Step 6: Verify collection both ways**

```bash
unset MEMORY_SCENARIO
npx playwright test --project e2e-electron --list 2>&1 | grep -c memory
```

Expected: `0`.

```bash
MEMORY_SCENARIO=idle npx playwright test --project e2e-electron --list 2>&1 | grep -c 'memory-idle'
```

Expected: non-zero.

- [ ] **Step 7: Commit**

```bash
git add test/e2e/utils/memory/scenarios.ts test/e2e/utils/memory/scenarios.vitest.ts playwright.config.ts
git commit -m "e2e: collect only the running memory scenario's spec"
```

---

### Task 5: The `session-python` scenario

**Files:**
- Create: `test/e2e/tests/performance/memory-session-python.test.ts`

**Interfaces:**
- Consumes: `defineMemoryScenario` from Task 3; `sessions.startAndSkipMetadata({ language, waitForReady })` from `test/e2e/pages/sessions.ts:491`, which returns the session id as a `string`.

- [ ] **Step 1: Write the spec**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// startAndSkipMetadata rather than start(): start() opens the console
// information dialog to read metadata, which this scenario does not need and
// which has its own RPC race (#14983). waitForReady is the settle point the
// design asks for; the collector then waits for the tree to stop growing.
//
// Auto-start stays off. settingsMemory.json pins interpreters.startupBehavior to
// manual, so the session measured here is the one this spec asked for, and no R
// session starts alongside it.
defineMemoryScenario({
	scenario: 'session-python',
	prepare: async ({ sessions }) => {
		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: true });
	},
	// kernel proves a Python kernel is running, kernel_supervisor proves
	// kcserver went from empty to hosting it. Without these the run could
	// publish an idle-shaped number as if the session were free.
	expectRoles: ['kernel', 'kernel_supervisor']
});
```

- [ ] **Step 2: Run it against a real build**

This needs a downloaded Positron build, not a dev build, and Linux for `smaps_rollup`. On Linux with a build available:

```bash
export BUILD=/path/to/positron-build/positron-linux
export MEMORY_SCENARIO=session-python
export MEMORY_LAUNCH_INDEX=0
npx playwright test test/e2e/tests/performance/memory-session-python.test.ts --project e2e-electron --grep 'Memory footprint'
```

Expected: PASS, with a console line reading `[memory] session-python launch 0: <N> MB PSS ...`, and N meaningfully above the ~1928 MB idle figure.

If you are not on Linux, skip to Step 3 and let the workflow in Task 7 be the verification. Say so plainly rather than reporting the step as passing.

- [ ] **Step 3: Confirm the role assertion actually bites**

Temporarily change `language: 'Python'` to a version that cannot resolve, for example add `version: '2.7.0'`, and rerun. Expected: FAIL on either the session start or the `expected a kernel process` assertion, not a pass with an idle-shaped total. Revert the change.

This step matters more than Step 2. A scenario that silently measures idle when the session fails is the one failure mode that would corrupt the trend without anyone noticing.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/tests/performance/memory-session-python.test.ts
git commit -m "e2e: add the session-python memory scenario"
```

---

### Task 6: The `session-r` scenario

**Files:**
- Create: `test/e2e/tests/performance/memory-session-r.test.ts`

**Interfaces:**
- Consumes: the same as Task 5.

- [ ] **Step 1: Write the spec**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Separate from session-python rather than one scenario starting both. label.ts
// maps ipykernel_launcher and ark to a single `kernel` role, and both extensions
// load their session code into the same extension host heap, so a combined run
// could not tell an R-side regression from a Python-side one.
defineMemoryScenario({
	scenario: 'session-r',
	prepare: async ({ sessions }) => {
		await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
	},
	expectRoles: ['kernel', 'kernel_supervisor']
});
```

- [ ] **Step 2: Run it against a real build**

```bash
export BUILD=/path/to/positron-build/positron-linux
export MEMORY_SCENARIO=session-r
export MEMORY_LAUNCH_INDEX=0
npx playwright test test/e2e/tests/performance/memory-session-r.test.ts --project e2e-electron --grep 'Memory footprint'
```

Expected: PASS, with `[memory] session-r launch 0: ...`.

- [ ] **Step 3: Confirm Ark is the kernel that got measured**

Read the written snapshot and check the `kernel` row is Ark, not a leftover Python kernel:

```bash
python3 -c "
import json
d = json.load(open('$RUNNER_TEMP/memory-snapshots-session-r/memory-snapshot-0.json'))
print([p['cmdBasename'] for p in d['processes'] if p['processRole'] == 'kernel'])
"
```

Expected: `['ark']`, exactly one entry. Two entries means auto-start is still on and both languages started, which invalidates the split this scenario exists for.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/tests/performance/memory-session-r.test.ts
git commit -m "e2e: add the session-r memory scenario"
```

---

### Task 7: Turn the workflow into a per-scenario matrix

Three scenarios in one job would run nine launches sequentially and re-pay nothing. A matrix runs them in parallel, each job re-paying the 6.5 minute setup, which keeps wall clock near a single job's.

**Files:**
- Modify: `.github/workflows/test-memory-metrics.yml`

**Interfaces:**
- Consumes: the spec paths and test names from Tasks 3, 5, and 6.

- [ ] **Step 1: Add the matrix and parameterize the job**

Replace the `jobs:` block's opening with:

```yaml
jobs:
  memory:
    name: measure-${{ matrix.scenario }}-memory
    runs-on: ubuntu-latest-8x
    timeout-minutes: 45
    strategy:
      # One scenario's failure should not cancel the others: a broken session
      # scenario must not cost us that night's idle datapoint.
      fail-fast: false
      matrix:
        scenario: [idle, session-python, session-r]
```

Keep the `container`, `options`, and `credentials` blocks exactly as they are.

- [ ] **Step 2: Take the scenario from the matrix**

In the job's `env:` block, replace the hardcoded line:

```yaml
      MEMORY_SCENARIO: idle
```

with:

```yaml
      MEMORY_SCENARIO: ${{ matrix.scenario }}
      MEMORY_SPEC: test/e2e/tests/performance/memory-${{ matrix.scenario }}.test.ts
```

Update the comment above it: the variable is still job-wide because the render step needs it too, but it now comes from the matrix.

Also update the comment on the interpreter env vars. It currently says "No interpreter is installed or started here," which stops being true for two of the three jobs. Replace it with a note that idle pins startup behavior to manual and the session scenarios start their session explicitly, so all three need these set.

- [ ] **Step 3: Point the launch and render steps at the matrix spec**

The three measure steps and the render step each hardcode `memory-idle.test.ts` and grep names the factory changed in Task 3. Replace each measure step's `run:` with:

```yaml
        run: npx playwright test "$MEMORY_SPEC" --project e2e-electron --grep 'Memory footprint'
```

and the render step's with:

```yaml
        run: npx playwright test "$MEMORY_SPEC" --project e2e-electron --grep 'Render and publish'
```

- [ ] **Step 4: Give each job its own artifact and snapshot path**

The upload step's `name: memory-report` would collide across matrix jobs. Change it to:

```yaml
        with:
          name: memory-report-${{ matrix.scenario }}
          path: ${{ runner.temp }}/memory-snapshots-${{ matrix.scenario }}/
          if-no-files-found: warn
```

The path must match `snapshotDir()` from Task 3. Update the comment, which still says the path matches `SNAPSHOT_DIR` in the spec.

- [ ] **Step 5: Dispatch the workflow and confirm all three jobs**

```bash
gh workflow run test-memory-metrics.yml -R posit-dev/positron --ref <this-branch>
gh run watch <run-id> -R posit-dev/positron
```

Expected: three jobs, all green, each with its own step summary naming its scenario, and three separate artifacts.

- [ ] **Step 6: Confirm the numbers are ordered as the design predicts**

Download all three artifacts and compare totals:

```bash
for s in idle session-python session-r; do
  gh run download <run-id> -R posit-dev/positron -n "memory-report-$s" -D "/tmp/mem-$s"
  python3 -c "
import json
d = json.load(open('/tmp/mem-$s/memory-snapshot-0.json'))
print('$s', round(d['treeTotalPssBytes'] / 1048576, 1), 'MB', d['scenario'])
"
done
```

Expected: `idle` near the 1928 MB already recorded, both session scenarios above it, and each file's `scenario` field matching its artifact. A session total equal to idle means the session never started and the role assertion did not catch it, which is a bug in Task 5 or 6, not a result.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/test-memory-metrics.yml
git commit -m "ci: run the memory scenarios as a matrix"
```

---

### Task 8: Update the issues to match what shipped

- [ ] **Step 1: Update #15491**

Read the body first and edit it, rather than replacing it, so any appended blocks survive:

```bash
gh api repos/posit-dev/positron/issues/15491 --jq '.body' > /tmp/15491.md
```

Edit `/tmp/15491.md` to record that the session scenarios keep `interpreters.startupBehavior: manual` and start explicitly, replacing the line about the settings fixture letting interpreters start. Then:

```bash
gh api repos/posit-dev/positron/issues/15491 -X PATCH -F body=@/tmp/15491.md
```

- [ ] **Step 2: Tick step 4 on the epic**

Same read-first pattern on #15001, changing `- [ ] **4. Session-start scenario**` to `- [x]`.

- [ ] **Step 3: Note what the matrix leaves for #15492**

Add a comment to #15492 saying the matrix exists and a new scenario is now three edits: a spec file, an entry in `MEMORY_SCENARIOS` and `SPEC_BY_SCENARIO` in `test/e2e/utils/memory/scenarios.ts`, and a value in the workflow's matrix list.

---

## Out of scope

- The `data-explorer`, `notebook`, `plots`, and `assistant` scenarios. #15492, and the assistant one is still gated on the probe from the design doc.
- Computing the delta of a scenario against its baseline. The design defines cost as `scenario_total - baseline_total`, but that subtraction belongs to the dashboard, #15495.
- Thresholds and alerting. #15496.
- The server lane. #15493.
- Per-extension heap attribution, which is what would finally explain the 155 MB `electron-nodejs (index.js)` process. #15494.
