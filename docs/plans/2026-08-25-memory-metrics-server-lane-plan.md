# Memory Metrics Server Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure `positron-server`'s memory in the nightly harness as a second
lane, without ever letting a server figure be differenced against a desktop one.

**Architecture:** A `lane` dimension (`desktop` | `server`) runs alongside the
existing `scenario` dimension. The collector roots its process-tree walk at a
lane-agnostic `rootPid` instead of the Electron main process. The cross-scenario
summary is partitioned by lane so deltas are computed only within a lane. Two
adjacent correctness fixes ride along.

**Tech Stack:** TypeScript, Playwright, Vitest, GitHub Actions.

**Spec:** `docs/design/2026-08-25-memory-metrics-server-lane-design.md`

## Global Constraints

- Tabs for indentation in TypeScript, never spaces.
- ASCII punctuation only: no em-dashes, en-dashes, smart quotes.
- Upstream files (`src/**`, `test/e2e/infra/code.ts`,
  `test/e2e/infra/playwrightBrowser.ts`, `playwright.config.ts`) need Positron
  markers: `// --- Start Positron ---` / `// --- End Positron ---` with a reason.
- New tests are Vitest (`*.vitest.ts`) in `test/e2e/utils/memory/`. Never add a
  `.test.ts` under `src/vs/` for this.
- Run Vitest with `npx vitest run test/e2e/utils/memory/`. Typecheck with
  `npx tsc --noEmit -p test/e2e/tsconfig.json`. Never run `tsc` against
  `src/tsconfig.json`.
- Before each commit: `npm run precommit`.
- `MEMORY_SCENARIOS` strings are a published contract. Do not rename or add to
  them; the lane is a separate dimension.
- Ships as ONE PR.

---

### Task 1: Lane primitives

**Files:**
- Create: `test/e2e/utils/memory/lanes.ts`
- Create: `test/e2e/utils/memory/lanes.vitest.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MEMORY_LANES: readonly ['desktop', 'server']`, `type MemoryLane`,
  `isMemoryLane(value: string | undefined): value is MemoryLane`,
  `laneFromEnv(value: string | undefined): MemoryLane`.

- [ ] **Step 1: Write the failing test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isMemoryLane, laneFromEnv, MEMORY_LANES } from './lanes.js';

describe('MEMORY_LANES', () => {
	test('is exactly desktop and server', () => {
		expect(MEMORY_LANES).toEqual(['desktop', 'server']);
	});
});

describe('isMemoryLane', () => {
	test('accepts the known lanes', () => {
		expect(isMemoryLane('desktop')).toBe(true);
		expect(isMemoryLane('server')).toBe(true);
	});

	test('rejects a near miss rather than coercing it', () => {
		// 'serve' reaching the collector as a valid lane would publish a server
		// measurement under the desktop key, which is unrecoverable after the fact.
		expect(isMemoryLane('serve')).toBe(false);
		expect(isMemoryLane('')).toBe(false);
		expect(isMemoryLane(undefined)).toBe(false);
	});
});

describe('laneFromEnv', () => {
	test('defaults to desktop when unset, so every existing invocation is unchanged', () => {
		expect(laneFromEnv(undefined)).toBe('desktop');
		expect(laneFromEnv('')).toBe('desktop');
	});

	test('returns a valid lane unchanged', () => {
		expect(laneFromEnv('server')).toBe('server');
	});

	test('throws on an invalid lane rather than falling back to desktop', () => {
		// Silently defaulting would label a server run desktop. Failing the job is
		// the only outcome that cannot corrupt a series.
		expect(() => laneFromEnv('serve')).toThrow(/serve/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/lanes.vitest.ts`
Expected: FAIL, cannot resolve `./lanes.js`.

- [ ] **Step 3: Write the implementation**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which process tree a memory run measures. Part of the published series key
 * alongside `scenario` and `branch`, so these strings are a contract: renaming
 * one splits its history in two.
 *
 * A server total is not comparable to a desktop total. The renderer and GPU run
 * in the user's browser, outside the server's process tree, so the largest role
 * on desktop is simply absent. The lane exists to make that difference
 * structural rather than something a reader has to remember.
 */
export const MEMORY_LANES = ['desktop', 'server'] as const;

export type MemoryLane = typeof MEMORY_LANES[number];

export function isMemoryLane(value: string | undefined): value is MemoryLane {
	return value !== undefined && MEMORY_LANES.includes(value as MemoryLane);
}

/**
 * The lane a run is measuring, from `MEMORY_LANE`.
 *
 * Unset means `desktop`, so every invocation that predates lanes keeps working
 * untouched. An invalid value throws rather than falling back: a typo that
 * defaulted to desktop would file a server measurement under the desktop key,
 * and nothing downstream could detect it afterwards.
 */
export function laneFromEnv(value: string | undefined): MemoryLane {
	if (value === undefined || value === '') {
		return 'desktop';
	}
	if (!isMemoryLane(value)) {
		throw new Error(`MEMORY_LANE is '${value}'; expected one of: ${MEMORY_LANES.join(', ')}`);
	}
	return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/e2e/utils/memory/lanes.vitest.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/lanes.ts test/e2e/utils/memory/lanes.vitest.ts
git add test/e2e/utils/memory/lanes.ts test/e2e/utils/memory/lanes.vitest.ts
git commit -m "e2e: add memory lane primitives"
```

---

### Task 2: Lane-aware spec selection

**Files:**
- Modify: `test/e2e/utils/memory/scenarios.ts`
- Modify: `test/e2e/utils/memory/scenarios.vitest.ts`
- Modify: `playwright.config.ts:100-116` (e2e-electron), plus the `e2e-chromium`
  and `e2e-server` project blocks

**Interfaces:**
- Consumes: `MemoryLane`, `laneFromEnv` from Task 1.
- Produces: `memorySpecsToIgnore(lane: MemoryLane, scenario: string | undefined): string[]`
  — note the lane is required and first, with no default.

- [ ] **Step 1: Write the failing test**

Append to `test/e2e/utils/memory/scenarios.vitest.ts`:

```ts
describe('memorySpecsToIgnore with lanes', () => {
	test('ignores every memory spec when no scenario is set', () => {
		const ignored = memorySpecsToIgnore('desktop', undefined);
		// 7 desktop specs + 1 server spec: an ordinary e2e lane must run none.
		expect(ignored).toHaveLength(8);
	});

	test('keeps only the running desktop scenario', () => {
		const ignored = memorySpecsToIgnore('desktop', 'idle');
		expect(ignored).not.toContain('**/performance/memory-idle.test.ts');
		expect(ignored).toContain('**/performance/memory-server-idle.test.ts');
	});

	test('keeps only the running server scenario', () => {
		const ignored = memorySpecsToIgnore('server', 'idle');
		expect(ignored).toContain('**/performance/memory-idle.test.ts');
		expect(ignored).not.toContain('**/performance/memory-server-idle.test.ts');
	});

	test('a scenario with no spec in the requested lane ignores everything', () => {
		// Only idle exists in the server lane. Asking for server/notebook must not
		// silently fall through to the desktop notebook spec.
		const ignored = memorySpecsToIgnore('server', 'notebook');
		expect(ignored).toHaveLength(8);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: FAIL, `memorySpecsToIgnore` takes one argument.

- [ ] **Step 3: Write the implementation**

Replace `SPEC_BY_SCENARIO` and `memorySpecsToIgnore` in `scenarios.ts`:

```ts
/**
 * The spec file that measures each lane/scenario pair.
 *
 * Sparse on purpose: only `idle` exists in the server lane. A pair with no spec
 * is not runnable, and asking for one must ignore everything rather than fall
 * through to the desktop spec of the same name.
 */
const SPEC_BY_LANE_SCENARIO: Record<MemoryLane, Partial<Record<MemoryScenario, string>>> = {
	desktop: {
		'idle': '**/performance/memory-idle.test.ts',
		'session-python': '**/performance/memory-session-python.test.ts',
		'session-r': '**/performance/memory-session-r.test.ts',
		'data-explorer': '**/performance/memory-data-explorer.test.ts',
		'notebook': '**/performance/memory-notebook.test.ts',
		'editors': '**/performance/memory-editors.test.ts',
		'console-output': '**/performance/memory-console-output.test.ts'
	},
	server: {
		'idle': '**/performance/memory-server-idle.test.ts'
	}
};

/** Every memory spec, in every lane. */
const ALL_MEMORY_SPECS: string[] = MEMORY_LANES
	.flatMap(lane => Object.values(SPEC_BY_LANE_SCENARIO[lane]))
	.filter((spec): spec is string => spec !== undefined);

/**
 * Which memory specs a run must not collect: every one except the running
 * lane/scenario pair's, and all of them when no scenario is set.
 *
 * `lane` is required with no default. A default would let a call site that was
 * never updated produce a lane-filtered list where the old code meant a
 * lane-agnostic one, and the compiler could not catch it.
 */
export function memorySpecsToIgnore(lane: MemoryLane, scenario: string | undefined): string[] {
	const running = isMemoryScenario(scenario) ? SPEC_BY_LANE_SCENARIO[lane][scenario] : undefined;
	return ALL_MEMORY_SPECS.filter(spec => spec !== running);
}
```

Add to the imports at the top of `scenarios.ts`:

```ts
import { MEMORY_LANES, MemoryLane } from './lanes.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/e2e/utils/memory/scenarios.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Wire the three Playwright projects**

In `playwright.config.ts`, the existing `e2e-electron` call becomes lane-aware,
and the two `@:web` projects gain the same guard. Inside the Positron markers
already present at `e2e-electron`:

```ts
				...memorySpecsToIgnore(laneFromEnv(process.env.MEMORY_LANE), process.env.MEMORY_SCENARIO),
```

Add to the `e2e-chromium` project block (it has no `testIgnore` today):

```ts
			// --- Start Positron ---
			// The server memory lane runs here, because e2e-chromium takes the
			// spawned-server path that gives the collector a process tree to walk.
			// Without this guard the server memory spec would be eligible in every
			// ordinary @:web run.
			testIgnore: [
				...memorySpecsToIgnore(laneFromEnv(process.env.MEMORY_LANE), process.env.MEMORY_SCENARIO),
			],
			// --- End Positron ---
```

Add the same `testIgnore` block to `e2e-server`, with this comment instead:

```ts
			// --- Start Positron ---
			// e2e-server uses an externally started server, so Code holds null in
			// the process slot and there is no tree to walk. A memory spec running
			// here would produce an empty process list rather than an error, so it
			// is excluded unconditionally.
			// --- End Positron ---
```

Add the import: `import { laneFromEnv } from './test/e2e/utils/memory/lanes';`

- [ ] **Step 6: Verify no ordinary lane picks up a memory spec**

Run: `npx playwright test --list --project e2e-chromium 2>&1 | grep -c memory-`
Expected: `0`

Run: `MEMORY_LANE=server MEMORY_SCENARIO=idle npx playwright test --list --project e2e-chromium 2>&1 | grep -c memory-server-idle`
Expected: `1`

- [ ] **Step 7: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/scenarios.ts playwright.config.ts
git add test/e2e/utils/memory/scenarios.ts test/e2e/utils/memory/scenarios.vitest.ts playwright.config.ts
git commit -m "e2e: select memory specs by lane and scenario"
```

---

### Task 3: Lane-agnostic root pid

**Files:**
- Modify: `test/e2e/infra/code.ts:172-195`
- Modify: `test/e2e/tests/performance/memory-scenario.ts:90-91`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Code.rootPid: number | undefined`.

- [ ] **Step 1: Add the accessor to `Code`**

`mainProcess` already holds the server's `ChildProcess` on the spawned browser
path (`code.ts:158`) and the Electron process on the desktop path (`:167`), but
it is `private`. Inside the existing Positron markers around that field, add:

```ts
	// --- Start Positron ---
	/**
	 * The process to root a process-tree walk at, whichever lane is running.
	 *
	 * Electron supplies the main process; the spawned browser path supplies the
	 * server. Undefined on the external-server path, which holds null here
	 * because the server was started outside Playwright.
	 */
	get rootPid(): number | undefined {
		return this.electronApp?.process().pid ?? this.mainProcess?.pid ?? undefined;
	}
	// --- End Positron ---
```

- [ ] **Step 2: Make the spec's assertion lane-agnostic**

Replace `memory-scenario.ts:90-91`:

```ts
			// Lane-agnostic: Electron supplies its main process, the server lane
			// supplies the server. Undefined means the external-server path, which
			// has no tree to walk and would otherwise publish an empty process list.
			const rootPid = app.code.rootPid;
			expect(rootPid, 'no root pid; this lane gives the collector no process tree to walk').toBeTruthy();
```

Then replace the use at `:113` (`rootPid: mainPid!`) with `rootPid: rootPid!`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p test/e2e/tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
npm run precommit -- test/e2e/infra/code.ts test/e2e/tests/performance/memory-scenario.ts
git add test/e2e/infra/code.ts test/e2e/tests/performance/memory-scenario.ts
git commit -m "e2e: root the memory walk at a lane-agnostic pid"
```

---

### Task 4: Carry the lane through snapshot and payload

**Files:**
- Modify: `test/e2e/utils/memory/types.ts` (`MemorySnapshot`)
- Modify: `test/e2e/utils/memory/snapshot.ts` (`captureSnapshot`)
- Modify: `test/e2e/utils/memory/publish.ts` (`MemoryPayload`, `buildPayload`)
- Modify: `test/e2e/tests/performance/memory-scenario.ts` (snapshot dir)
- Modify: `test/e2e/utils/memory/publish.vitest.ts`

**Interfaces:**
- Consumes: `MemoryLane` from Task 1.
- Produces: `MemorySnapshot.lane: MemoryLane`, `MemoryPayload.lane: MemoryLane`,
  `snapshotDir(lane, scenario)`, and `defineMemoryScenario`'s new `lane?: MemoryLane`
  and `tag?: string` options (both defaulted, so the seven existing specs are
  untouched).

- [ ] **Step 1: Write the failing test**

Append to `publish.vitest.ts`:

```ts
describe('buildPayload lane', () => {
	test('carries the snapshot lane onto the payload', () => {
		const snapshot = { ...baseSnapshot, lane: 'server' as const };
		const payload = buildPayload([snapshot], meta);
		expect(payload.lane).toBe('server');
	});

	test('desktop snapshots publish lane desktop explicitly, never undefined', () => {
		// An absent lane would be defaulted server-side, which is a guess we can
		// avoid making by always stating it.
		const payload = buildPayload([{ ...baseSnapshot, lane: 'desktop' as const }], meta);
		expect(payload.lane).toBe('desktop');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: FAIL, `lane` is not a property of `MemoryPayload`.

- [ ] **Step 3: Implement**

In `types.ts`, add to `MemorySnapshot` beside `scenario`:

```ts
	/** Which process tree this measured. Part of the published series key. */
	lane: MemoryLane;
```

In `publish.ts`, add to `MemoryPayload` beside `scenario`:

```ts
	lane: MemoryLane;
```

and in `buildPayload`'s returned object, beside `scenario: first.scenario`:

```ts
		lane: first.lane,
```

In `snapshot.ts`, add `lane: MemoryLane` to `captureSnapshot`'s input and pass it
straight onto the returned snapshot beside `scenario`.

In `memory-scenario.ts`, make the snapshot directory lane-qualified so two lanes
in one run cannot read each other's files:

```ts
function snapshotDir(lane: MemoryLane, scenario: MemoryScenario): string {
	return join(process.env.RUNNER_TEMP ?? '/tmp', `memory-snapshots-${lane}-${scenario}`);
}
```

Also extend `defineMemoryScenario`'s options with the two fields Tasks 5 and 9
rely on, defaulting so every existing desktop spec compiles unchanged:

```ts
	/**
	 * Which tree to measure. Defaults to `desktop` so the seven existing specs
	 * need no edit.
	 */
	lane?: MemoryLane;
	/**
	 * Extra Playwright tag. The server spec needs `@:web` to be eligible in
	 * e2e-chromium, which is the project that spawns the server and so gives the
	 * collector a tree to walk.
	 */
	tag?: string;
```

and in the destructure:

```ts
	const { scenario, lane = 'desktop', tag, prepare, expectRoles = [], expectProcesses = [] } = options;
	const SNAPSHOT_DIR = snapshotDir(lane, scenario);
	const testTags = tag ? [tags.PERFORMANCE, tag] : [tags.PERFORMANCE];
```

Both `test.describe` calls take `{ tag: testTags }` in place of
`{ tag: [tags.PERFORMANCE] }`, and the describe titles gain the lane so a server
row is distinguishable in a report: `Memory: ${lane} ${scenario}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/types.ts test/e2e/utils/memory/snapshot.ts test/e2e/utils/memory/publish.ts test/e2e/tests/performance/memory-scenario.ts
git add test/e2e/utils/memory/types.ts test/e2e/utils/memory/snapshot.ts test/e2e/utils/memory/publish.ts test/e2e/utils/memory/publish.vitest.ts test/e2e/tests/performance/memory-scenario.ts
git commit -m "e2e: carry the memory lane on the snapshot and payload"
```

---

### Task 5: Force a GC in the server lane

**Files:**
- Modify: `test/e2e/utils/memory/gc.ts` (`GC_TARGETS` becomes lane-aware)
- Modify: `test/e2e/utils/memory/gc.vitest.ts`
- Modify: `test/e2e/infra/playwrightBrowser.ts:219-234` (payload array)
- Modify: `test/e2e/tests/performance/memory-scenario.ts` (assert the GC ran)

**Interfaces:**
- Consumes: `MemoryLane` from Task 1.
- Produces: `gcTargetsFor(lane: MemoryLane): GcTarget[]`.

- [ ] **Step 1: Write the failing test**

Append to `gc.vitest.ts`:

```ts
describe('gcTargetsFor', () => {
	test('desktop collects the shared process and the extension host', () => {
		expect(gcTargetsFor('desktop').map(t => t.role)).toEqual(['shared', 'extension_host']);
	});

	test('server collects only the extension host', () => {
		// There is no shared process in the server lane; it is an Electron concept.
		// Attempting its port would fail on every run and invite someone to fix it.
		expect(gcTargetsFor('server').map(t => t.role)).toEqual(['extension_host']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/gc.vitest.ts`
Expected: FAIL, `gcTargetsFor` is not exported.

- [ ] **Step 3: Implement**

In `gc.ts`:

```ts
/**
 * Which processes to collect in a given lane.
 *
 * The shared process is Electron-only, so the server lane has one target. Its
 * inspector is not opened by a launch flag either: the remote extension host
 * takes its port from the client, over the workbench payload. See the spec's
 * "Forced GC in the server lane".
 */
export function gcTargetsFor(lane: MemoryLane): GcTarget[] {
	return lane === 'server'
		? GC_TARGETS.filter(target => target.role === 'extension_host')
		: GC_TARGETS;
}
```

- [ ] **Step 4: Open the server's inspector via the workbench payload**

In `playwrightBrowser.ts`, the payload array at `:219-226` already carries
`["logLevel", ...]`. Add the inspector entry for the server memory lane, inside
Positron markers:

```ts
		// --- Start Positron ---
		// The remote extension host takes its inspect port from the client, not the
		// server's argv, so the memory lane's forced GC is enabled here rather than
		// through extraArgs (which only the Electron launcher consumes).
		...(process.env.MEMORY_LANE === 'server' ? [`["inspect-extensions","5870"]`] : []),
		// --- End Positron ---
```

- [ ] **Step 5: Assert the GC actually ran**

In `memory-scenario.ts`, after the existing `treeSettled` gate:

```ts
			// The server route to the inspector is traced in code but new, so a
			// silently absent GC must fail rather than publish a noisier number that
			// looks like a regression later.
			expect(snapshot.forcedGc?.map(stats => stats.role),
				'no forced GC ran; the inspector port did not come up and these figures carry uncollected startup garbage')
				.toEqual(gcTargetsFor(lane).map(target => target.role));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/` then `npx tsc --noEmit -p test/e2e/tsconfig.json`
Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/gc.ts test/e2e/infra/playwrightBrowser.ts test/e2e/tests/performance/memory-scenario.ts
git add test/e2e/utils/memory/gc.ts test/e2e/utils/memory/gc.vitest.ts test/e2e/infra/playwrightBrowser.ts test/e2e/tests/performance/memory-scenario.ts
git commit -m "e2e: force a GC in the server lane via the workbench payload"
```

---

### Task 6: Refuse to publish an unsettled snapshot

**Files:**
- Modify: `test/e2e/utils/memory/publish.ts` (`publishSnapshots`)
- Modify: `test/e2e/utils/memory/publish.vitest.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change; `publishSnapshots` returns `false` without
  posting when any snapshot is unsettled.

- [ ] **Step 1: Write the failing test**

```ts
describe('publishSnapshots quality precondition', () => {
	test('refuses a snapshot whose tree never stopped growing', async () => {
		const published = await publishSnapshots(
			[{ ...baseSnapshot, stoppedGrowing: false }], meta);
		expect(published).toBe(false);
	});

	test('refuses a snapshot whose sampling never settled', async () => {
		const published = await publishSnapshots(
			[{ ...baseSnapshot, treeSettled: false }], meta);
		expect(published).toBe(false);
	});

	test('refuses when any one launch of three is unsettled', async () => {
		// The median of three is only as good as its worst launch, and a baseline
		// is permanent where a failed job is not.
		const published = await publishSnapshots(
			[baseSnapshot, { ...baseSnapshot, treeSettled: false }, baseSnapshot], meta);
		expect(published).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: FAIL. With `MEMORY_PUBLISH` unset these return `false` already, so set
`MEMORY_PUBLISH=true` and a fake `CONNECT_API_KEY` in the test's `beforeEach` so
the assertion is meaningful rather than vacuous.

- [ ] **Step 3: Implement**

Immediately after the `publishingEnabled()` and `CONNECT_API_KEY` guards in
`publishSnapshots`:

```ts
	// The spec gates on both flags before a snapshot is ever written, so this is
	// belt and braces. It is here anyway because that guarantee rests on
	// statement ordering in another file: gates before writeFileSync, and a
	// publish step that requires all three launch files. A refactor could defeat
	// either silently, and an unsettled launch that becomes the baseline is
	// permanent, where a failed job is not.
	const unsettled = snapshots.filter(s => s.stoppedGrowing !== true || s.treeSettled !== true);
	if (unsettled.length > 0) {
		console.error('[memory] refusing to publish: ' +
			unsettled.map(s => `launch ${s.launchIndex} (stoppedGrowing=${s.stoppedGrowing}, treeSettled=${s.treeSettled})`).join(', '));
		return false;
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/publish.ts
git add test/e2e/utils/memory/publish.ts test/e2e/utils/memory/publish.vitest.ts
git commit -m "e2e: refuse to publish an unsettled memory snapshot"
```

---

### Task 7: Baseline query, response tightening, and visible failures

**Files:**
- Modify: `test/e2e/utils/memory/publish.ts` (`BaselineResponse`,
  `baselineToSnapshot`, `fetchBaseline`)
- Modify: `test/e2e/utils/memory/publish.vitest.ts`

**Interfaces:**
- Consumes: `MemoryLane` from Task 1.
- Produces: `fetchBaseline(scenario: MemoryScenario, lane: MemoryLane): Promise<MemorySnapshot | undefined>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('baselineToSnapshot activation_event', () => {
	test('coerces a non-string to null rather than passing it through', () => {
		// The API briefly serialized null as {}. Truthy, so `?? null` kept it, and
		// it inverted the baselineKnowsEvents guard in render.ts so every eager
		// extension read as newly eager. Validate, do not cast: the same function
		// already does this for process_role.
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'desktop',
			snapshot: {
				tree_total_pss_bytes: 1, settle_ms: 1, processes: [],
				extensions: [{ extension_id: 'a.b', activation_event: {} as unknown as string }]
			}
		} as BaselineResponse;
		const snapshot = baselineToSnapshot(body, 'idle');
		expect(snapshot?.extensions[0].activationEvent).toBeNull();
	});

	test('keeps a real activation event', () => {
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'desktop',
			snapshot: {
				tree_total_pss_bytes: 1, settle_ms: 1, processes: [],
				extensions: [{ extension_id: 'a.b', activation_event: 'onStartupFinished' }]
			}
		} as BaselineResponse;
		expect(baselineToSnapshot(body, 'idle')?.extensions[0].activationEvent).toBe('onStartupFinished');
	});
});

describe('baseline query', () => {
	test('sends lane and container_image', () => {
		expect(baselineQuery('idle', 'server', 'ghcr.io/x:1'))
			.toBe('?scenario=idle&branch=main&lane=server&container_image=ghcr.io%2Fx%3A1');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: FAIL, `baselineQuery` is not exported.

- [ ] **Step 3: Implement**

Tighten `BaselineResponse` — the provenance fields become required, the miss
branch gains a reason, and `activation_event` becomes required-but-nullable:

```ts
export type BaselineResponse =
	| { found: false; reason: 'no_baseline' }
	| { found: false; reason: 'image_mismatch'; available_container_image: string }
	| {
		found: true;
		container_image: string;
		run_id: string;
		app_version: string;
		lane: string;
		snapshot: {
			tree_total_pss_bytes: number;
			settle_ms: number;
			processes: { process_name: string; process_role: string; pss_bytes: number }[];
			extensions: { extension_id: string; activation_event: string | null }[];
		};
	};
```

The optionality that was there before defended against endpoint versions that
never shipped. The endpoint is not deployed, so there is no released shape to
stay compatible with.

Add the query builder and validate `activation_event`:

```ts
export function baselineQuery(scenario: MemoryScenario, lane: MemoryLane, containerImage: string): string {
	const params = new URLSearchParams({
		scenario, branch: 'main', lane, container_image: containerImage
	});
	return `?${params.toString()}`;
}
```

In `baselineToSnapshot`'s extensions mapping, replace `e.activation_event ?? null`:

```ts
			// Validated rather than cast, matching processRole above. `??` defends
			// against absence but not against the wrong type.
			activationEvent: typeof e.activation_event === 'string' ? e.activation_event : null
```

In `fetchBaseline`, take the lane, use the builder, and log any non-2xx:

```ts
		if (response.statusCode >= 400) {
			// Logged, not swallowed. The API returns 400 on an invalid lane, and
			// without this that is as invisible as an empty store, so a typo in the
			// query would read as a permanently missing baseline.
			console.error(`[memory] baseline request failed with ${response.statusCode}: ${await response.body.text()}`);
			return undefined;
		}
		const body = await response.body.json() as BaselineResponse;
		if (!body.found) {
			console.log(`[memory] no baseline: ${body.reason}` +
				(body.reason === 'image_mismatch' ? ` (newest available: ${body.available_container_image})` : ''));
		}
		return baselineToSnapshot(body, scenario);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/` and `npx tsc --noEmit -p test/e2e/tsconfig.json`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/publish.ts
git add test/e2e/utils/memory/publish.ts test/e2e/utils/memory/publish.vitest.ts
git commit -m "e2e: query the baseline by lane and image, and surface rejections"
```

---

### Task 8: Partition the summary by lane

**Files:**
- Modify: `test/e2e/utils/memory/summarize-cli.ts` (`CollectedScenario`,
  `collectScenarios`, `summarize`)
- Modify: `test/e2e/utils/memory/summary.vitest.ts`

**Interfaces:**
- Consumes: `MemoryLane`, `MEMORY_LANES` from Task 1.
- Produces: `summarize` renders one section per lane. `buildSummaryMatrix` is
  **unchanged** — given one lane's entries it already baselines on that lane's
  `idle`.

- [ ] **Step 1: Write the failing test**

```ts
describe('lane partitioning', () => {
	test('a server column is never differenced against desktop idle', () => {
		// Desktop idle is ~1495 MB and a server tree is ~820 MB because the
		// renderer is in the browser. Differencing them yields a ~-675 MB "drop"
		// that sorts to a prominent column, which is the whole failure this
		// partition exists to prevent.
		const sections = buildLaneSections([
			{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] },
			{ lane: 'server', scenario: 'idle', snapshots: [serverIdle] }
		]);
		expect(sections.map(s => s.lane)).toEqual(['desktop', 'server']);
		const server = sections.find(s => s.lane === 'server')!;
		expect(server.matrix.scenarios).toEqual(['idle']);
		for (const row of server.matrix.rows) {
			expect(row.deltaVsIdle).toEqual({});
		}
	});

	test('a lane with no data produces no section rather than an empty one', () => {
		const sections = buildLaneSections([
			{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] }
		]);
		expect(sections.map(s => s.lane)).toEqual(['desktop']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/summary.vitest.ts`
Expected: FAIL, `buildLaneSections` is not exported.

- [ ] **Step 3: Implement**

Add `lane` to `CollectedScenario` and parse it from the directory name. Artifact
directories are now `memory-report-<lane>-<scenario>`:

```ts
/**
 * The lane in the directory name exists only to keep two jobs' artifacts from
 * colliding, and is used only to locate files. `MemorySnapshot.lane` is
 * authoritative for partitioning: the path is consumed here and discarded before
 * any snapshot is constructed, so a renamed artifact cannot reclassify a
 * measurement.
 */
function laneAndScenarioFromDirName(name: string): { lane: MemoryLane; scenario: string } | undefined {
	const rest = name.startsWith(ARTIFACT_PREFIX) ? name.slice(ARTIFACT_PREFIX.length) : undefined;
	if (rest === undefined) {
		return undefined;
	}
	for (const lane of MEMORY_LANES) {
		if (rest.startsWith(`${lane}-`)) {
			return { lane, scenario: rest.slice(lane.length + 1) };
		}
	}
	return undefined;
}
```

Then group by the snapshots' own lane and build one matrix per lane:

```ts
export type LaneSection = { lane: MemoryLane; matrix: SummaryMatrix };

/**
 * One matrix per lane. `buildSummaryMatrix` needs no lane awareness: given only
 * one lane's entries it baselines on that lane's own `idle`, which is exactly
 * the required behaviour. Deltas are therefore within-lane by construction
 * rather than by a check someone could forget.
 */
export function buildLaneSections(entries: (ScenarioSnapshots & { lane: MemoryLane })[]): LaneSection[] {
	return MEMORY_LANES
		.map(lane => ({ lane, entries: entries.filter(e => e.lane === lane) }))
		.filter(group => group.entries.length > 0)
		.map(group => ({ lane: group.lane, matrix: buildSummaryMatrix(group.entries) }));
}
```

`summarize` renders each section in turn, with a standing note on the server
section that its total is not comparable to the desktop total and why.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/summarize-cli.ts
git add test/e2e/utils/memory/summarize-cli.ts test/e2e/utils/memory/summary.vitest.ts
git commit -m "e2e: partition the memory summary by lane"
```

---

### Task 9: The server idle spec

**Files:**
- Create: `test/e2e/tests/performance/memory-server-idle.test.ts`

**Interfaces:**
- Consumes: `defineMemoryScenario`'s `lane` and `tag` options from Task 4, and
  `tags.WEB` (`'@:web'`, exported from `test/e2e/tests/_test.setup.ts:635`).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the spec**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Tagged @:web because it genuinely runs in web mode: that is what makes it
// eligible in e2e-chromium, which takes the spawned-server path and so gives the
// collector a process tree to walk. playwright.config.ts keeps it out of every
// ordinary @:web run via memorySpecsToIgnore.
//
// No expectRoles: the server tree has no renderer or gpu (both are in the
// browser, outside this tree), and asserting the roles it does have would only
// restate what the report already shows.
defineMemoryScenario({ scenario: 'idle', lane: 'server', tag: tags.WEB });
```

- [ ] **Step 2: Confirm it is selected only under the memory lane**

Run: `MEMORY_LANE=server MEMORY_SCENARIO=idle npx playwright test --list --project e2e-chromium 2>&1 | grep -c memory-server-idle`
Expected: `1`

Run: `npx playwright test --list --project e2e-chromium 2>&1 | grep -c memory-`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
npm run precommit -- test/e2e/tests/performance/memory-server-idle.test.ts
git add test/e2e/tests/performance/memory-server-idle.test.ts
git commit -m "e2e: add the server idle memory scenario"
```

---

### Task 10: Workflow matrix and server build

**Files:**
- Modify: `.github/workflows/test-memory-metrics.yml`

**Interfaces:**
- Consumes: everything above.
- Produces: a `measure-server-idle-memory` job and lane-qualified artifacts.

- [ ] **Step 1: Convert the matrix to lane/scenario pairs**

Replace the bare scenario list at `:29-30`:

```yaml
      matrix:
        include:
          - { lane: desktop, scenario: idle }
          - { lane: desktop, scenario: session-python }
          - { lane: desktop, scenario: session-r }
          - { lane: desktop, scenario: data-explorer }
          - { lane: desktop, scenario: notebook }
          - { lane: desktop, scenario: editors }
          - { lane: desktop, scenario: console-output }
          # Only idle in the server lane: the desktop feature scenarios put ~90%
          # of their cost in the renderer, which is in the browser and outside
          # this tree, so they would measure the leftover tenth.
          - { lane: server, scenario: idle }
```

Job name and env become lane-aware:

```yaml
    name: measure-${{ matrix.lane }}-${{ matrix.scenario }}-memory
```

```yaml
      MEMORY_LANE: ${{ matrix.lane }}
      MEMORY_SCENARIO: ${{ matrix.scenario }}
      PW_PROJECT_NAME: ${{ matrix.lane == 'server' && 'e2e-chromium' || 'e2e-electron' }}
```

Artifact name at `:178` becomes `memory-report-${{ matrix.lane }}-${{ matrix.scenario }}`,
and the snapshot path at `:182` gains the lane to match Task 4's `snapshotDir`.

- [ ] **Step 2: Download the server tarball for the server lane**

The existing step calls `download-build.sh`, which resolves the Electron tarball.
`BUILD` must still be set from it, because the spec asserts on `BUILD` and reads
`product.json` under it for the version. The server lane needs a second download
on top:

```yaml
      - name: Download server build
        if: matrix.lane == 'server'
        env:
          VERSION: ${{ steps.download.outputs.version }}
        run: |
          set -euo pipefail
          case "$(uname -m)" in
            aarch64|arm64) ARCH=arm64 ;;
            x86_64|amd64)  ARCH=x64 ;;
            *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
          esac
          ASSET="positron-server-linux-${ARCH}-${VERSION}.tar.gz"
          gh release download "$VERSION" --repo posit-dev/positron-builds             --pattern "$ASSET" --dir "$RUNNER_TEMP"
          mkdir -p "$RUNNER_TEMP/positron-server"
          tar -xzf "$RUNNER_TEMP/$ASSET" -C "$RUNNER_TEMP/positron-server" --strip-components=1
          # resolveServerLocation (playwrightBrowser.ts:120) reads this to run the
          # built server's bin/<serverApplicationName> instead of the source script.
          echo "VSCODE_REMOTE_SERVER_PATH=$RUNNER_TEMP/positron-server" >> "$GITHUB_ENV"
```

Two things to check rather than assume: that `download-build.sh` exposes the
resolved version as a step output (it prints `BUILD=`; if it does not also print
the version, add it rather than re-resolving `latest-prerelease`, which could
drift between the two downloads), and that `bin/` under the extracted directory
contains the executable `resolveServerLocation` expects.

- [ ] **Step 3: Update the summarize job's expectations**

`summarize-memory` at `:192-249` walks `memory-report-<scenario>` directories.
Its scenario list must become the lane/scenario pairs so a missing artifact is
still reported as a warning rather than silently dropped.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test-memory-metrics.yml
git commit -m "e2e: add the server lane to the memory metrics workflow"
```

---

### Task 11: Dispatch and verify

**Files:** none.

- [ ] **Step 1: Push and dispatch**

```bash
git push -u origin HEAD
gh workflow run test-memory-metrics.yml --ref midleman/memory-metrics-server-lane -f version=<a release with linux assets>
```

Check the release has Linux assets first; a prerelease missing them fails every
job at the download step:

```bash
gh release view <tag> --repo posit-dev/positron-builds --json assets --jq '[.assets[].name | select(test("linux"))] | length'
```

- [ ] **Step 2: Confirm the server job measured a real tree**

In `measure-server-idle-memory`'s log, confirm: a non-empty process list, no
`renderer` or `gpu` role, an `extension_host` role present, and a `forcedGc`
entry for `extension_host`. An empty process list means the run took the
external-server path; an absent `forcedGc` means the inspector never came up.

- [ ] **Step 3: Confirm the summary has two sections**

The `summarize-memory` artifact must show a Desktop section with seven columns
and a Server section with one, and **no** server column inside the desktop
matrix.

- [ ] **Step 4: Hand the artifacts to the insights implementer**

The publish path cannot be exercised from a branch dispatch: `apiUrl` routes
non-`main` branches to localhost and `MEMORY_PUBLISH` is `'false'`. Send the run
id so the payload can be rebuilt from `buildPayload` and POSTed to the real API,
verifying storage layout, lane isolation, baseline shape and the image guard for
`lane=server` before it runs in production. **The design is not verified without
this step.**
