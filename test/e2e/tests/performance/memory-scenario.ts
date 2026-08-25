/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect, tags, test } from '../_test.setup';
import { Application, Sessions } from '../../infra';
import { readActivatedExtensions } from '../../utils/memory/extensions.js';
import { collectAllGarbage, gcTargetsFor, malformedForcedGc } from '../../utils/memory/gc.js';
import { namedShareGateApplies } from '../../utils/memory/label.js';
import { MemoryLane } from '../../utils/memory/lanes.js';
import { containerImageFromEnv, fetchBaseline, publishSnapshots } from '../../utils/memory/publish.js';
import { renderHtml, renderMarkdown } from '../../utils/memory/render.js';
import { captureSnapshot, SAMPLING_CAP_MS, SETTLE_CAP_MS, unstableProcesses } from '../../utils/memory/snapshot.js';
import { MemoryScenario } from '../../utils/memory/scenarios.js';
import { MemorySnapshot, ProcessRole } from '../../utils/memory/types.js';

/**
 * Above the job's own `timeout-minutes`, so anything older than this cannot have
 * come from the run doing the rendering.
 */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

/**
 * Everything in the measure test that is not settling or sampling: starting a
 * session, the readiness gate, `positron --status`, reading the ext host log,
 * and the quality gates. Generous because it only matters when something has
 * already gone wrong, and a timeout hides the reason.
 */
const MEASURE_OVERHEAD_MS = 90_000;

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
function snapshotDir(lane: MemoryLane, scenario: MemoryScenario): string {
	return join(process.env.RUNNER_TEMP ?? '/tmp', `memory-snapshots-${lane}-${scenario}`);
}

export function defineMemoryScenario(options: {
	scenario: MemoryScenario;
	/** Drives the app into the state being measured. Omitted for idle. */
	prepare?: (fixtures: {
		app: Application;
		sessions: Sessions;
		openDataFile: (filePath: string) => Promise<void>;
		openFile: (filePath: string, waitForFocus?: boolean) => Promise<void>;
	}) => Promise<void>;
	/** Roles that must be present, proving the scenario reached its state. */
	expectRoles?: ProcessRole[];
	/**
	 * Process names that must be present, for scenarios whose process is not
	 * distinguishable by role alone.
	 *
	 * `expectRoles` is enough when the scenario adds a role that idle lacks, as
	 * the session scenarios do with `kernel`. It is useless when the role is
	 * already occupied: the duckdb worker is an `extension_child`, but so is pet,
	 * which runs at idle, so requiring that role would pass on a run where the
	 * CSV never opened. Matched against the process name and the command
	 * basename, either of which identifies the worker.
	 */
	expectProcesses?: RegExp[];
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
}): void {
	const { scenario, lane = 'desktop', tag, prepare, expectRoles = [], expectProcesses = [] } = options;
	const SNAPSHOT_DIR = snapshotDir(lane, scenario);
	const testTags = tag ? [tags.PERFORMANCE, tag] : [tags.PERFORMANCE];

	test.describe(`Memory: ${lane} ${scenario}`, { tag: testTags }, () => {

		test(`Memory footprint of the Positron process tree: ${scenario}`, async function ({ app, sessions, logsPath, openDataFile, openFile }) {
			// Derived rather than a round number, because the default 2 minutes is
			// now too short: a run that waits out both caps would time out before it
			// could report which one it hit, turning a diagnosable result into a
			// bare timeout.
			test.setTimeout(SETTLE_CAP_MS + SAMPLING_CAP_MS + MEASURE_OVERHEAD_MS);

			// Only test-memory-metrics.yml collects these specs, and it always sets
			// BUILD. A missing one means the workflow is broken, not that the spec
			// ran somewhere it should not have.
			const buildRoot = process.env.BUILD;
			expect(buildRoot, 'BUILD must point at a Positron build; memory numbers from a dev build are meaningless').toBeTruthy();

			// Lane-agnostic: Electron supplies its main process, the server lane
			// supplies the server. Undefined means the external-server path, which
			// has no tree to walk and would otherwise publish an empty process list.
			const rootPid = app.code.rootPid;
			expect(rootPid, 'no root pid; this lane gives the collector no process tree to walk').toBeTruthy();

			if (prepare) {
				await prepare({ app, sessions, openDataFile, openFile });
			}

			// Deterministic readiness gate, not a memory heuristic: waits out startup
			// banners (session or otherwise), focuses the console, and parks the mouse
			// so a hover tooltip is not holding renderer allocations. Runs for every
			// scenario, including idle, so idle stays comparable to the states it is
			// the baseline for. waitForSettle below still guards a tree that is
			// genuinely mid-allocation.
			await app.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
			await sessions.expectNoStartUpMessaging();

			const extensions = await readActivatedExtensions({
				logsRoot: logsPath,
				extensionsDir: app.extensionsPath
			});

			const snapshot = await captureSnapshot({
				scenario,
				lane,
				rootPid: rootPid!,
				buildRoot: buildRoot!,
				userDataDir: app.userDataPath,
				launchIndex: Number(process.env.MEMORY_LAUNCH_INDEX ?? 0),
				extensions,
				forceGc: () => collectAllGarbage(gcTargetsFor(lane))
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

			// Same argument as expectRoles, for the processes a role cannot single
			// out. Reported with the names that were present, because "no duckdb
			// worker" and "the worker is there under a name this regex misses" need
			// different fixes and the failure text is the only place to tell them apart.
			for (const pattern of expectProcesses) {
				const matched = snapshot.processes.some(p =>
					pattern.test(p.processName) || pattern.test(p.cmdBasename));
				expect(matched,
					`scenario ${scenario} expected a process matching ${pattern}; the app never reached the state being measured. ` +
					`Present: ${snapshot.processes.map(p => p.processName).join(', ')}`).toBe(true);
			}

			// waitForSettle gives up at its cap regardless of whether the tree actually
			// stopped growing, so a snapshot taken at the cap is a mid-load number, not
			// the steady state the scenario claims. Asserted on the reported flag, not
			// on settleMs, which cannot distinguish the two.
			expect(snapshot.stoppedGrowing,
				`the tree never stopped growing within the ${SETTLE_CAP_MS / 1000}s cap, so this is a mid-load number rather than a steady state`)
				.toBe(true);

			// PSS can never exceed RSS at one instant, so a violation means procfs
			// was misparsed or the two figures came from different samples -- the
			// defect that let a renderer publish 433 MB while sitting at 306 MB.
			const impossible = snapshot.processes.filter(p =>
				p.pssSamples.some((pss, index) => pss > p.rssSamples[index]));
			expect(impossible.map(p => `${p.processName} (pid ${p.pid})`),
				'PSS exceeded RSS, which is impossible within one sample').toEqual([]);

			// False means sampling gave up at the cap, so the figures are mid-load. The
			// `moving` check below cannot stand in for this, though it was written as if
			// it could: only the tail is retained, so an `editors` launch that spent the
			// full 90s unsettled passed every gate while publishing a tree total 100 MB
			// below its two siblings.
			expect(snapshot.treeSettled,
				`sampling ran to its ${SAMPLING_CAP_MS / 1000}s cap without the tree settling, so this is a mid-load number`)
				.toBe(true);

			// The server route to the inspector is traced in code but new, so a
			// silently absent GC must fail rather than publish a noisier number that
			// looks like a regression later.
			expect(snapshot.forcedGc?.map(stats => stats.role),
				'no forced GC ran; the inspector port did not come up and these figures carry uncollected startup garbage')
				.toEqual(gcTargetsFor(lane).map(target => target.role));

			// A live process cannot legitimately report a zero pid, RSS, or heap total,
			// so any entry that does is a malformed reading, not a GC pass that ran.
			const malformed = malformedForcedGc(snapshot.forcedGc ?? []);
			expect(malformed,
				`forced GC for ${gcTargetsFor(lane).map(target => target.label).join(', ')} returned malformed readings ` +
				`(zero pid, RSS, or heap total): ${JSON.stringify(malformed)}`)
				.toEqual([]);

			// Per-process quiescence, which is a weaker condition than the tree
			// settling: this catches a process still visibly moving within the
			// retained tail. Asserted rather than logged: a plausible-looking number
			// that describes no actual state is worse than a failed job, since only
			// the failure is visible.
			const moving = unstableProcesses(snapshot.processes);
			for (const proc of moving) {
				console.log(`[memory] ${scenario} launch ${snapshot.launchIndex}: ${proc.processName} (${proc.processRole}) was still moving: ` +
					`${(proc.pssMin / 1048576).toFixed(1)}-${(proc.pssMax / 1048576).toFixed(1)} MB, reporting ${(proc.pssBytes / 1048576).toFixed(1)} MB`);
			}
			expect(moving.map(p => `${p.processName} (${p.processRole})`),
				`sampling hit its ${SAMPLING_CAP_MS / 1000}s cap with processes still moving, so these figures are mid-swing`).toEqual([]);

			// See namedShareGateApplies (label.ts) for why the server lane skips this:
			// `--status` cannot answer there at all, so every process is unlabeled by
			// construction and the gate would fail every server run regardless of
			// attribution quality. The unlabeledBytes gate below stays lane-agnostic
			// and still catches a genuinely unattributable tree.
			if (namedShareGateApplies(lane)) {
				const namedShare = snapshot.processes.filter(p => p.labeled).length / snapshot.processes.length;
				expect(namedShare, 'Positron named too few processes; --status probably failed, and an unattributable total is worse than no data').toBeGreaterThan(0.5);
			}

			const unlabeledBytes = snapshot.processes
				.filter(p => p.processRole === 'unlabeled')
				.reduce((sum, p) => sum + p.pssBytes, 0);
			expect(unlabeledBytes / snapshot.treeTotalPssBytes, 'more than a third of memory is unattributed; add rules to label.ts').toBeLessThan(0.34);

			expect(snapshot.extensions.length, 'no activated extensions found; findExtHostLog probably looked in the wrong logsRoot').toBeGreaterThan(0);

			mkdirSync(SNAPSHOT_DIR, { recursive: true });
			writeFileSync(join(SNAPSHOT_DIR, `memory-snapshot-${snapshot.launchIndex}.json`), JSON.stringify(snapshot, null, 2));

			console.log(`[memory] ${scenario} launch ${snapshot.launchIndex}: ${(snapshot.treeTotalPssBytes / 1048576).toFixed(1)} MB PSS across ${snapshot.processes.length} processes, ` +
				`settled in ${snapshot.settleMs} ms, sampled for ${snapshot.sampledMs} ms discarding ${snapshot.discardedSamples} startup samples`);
		});
	});

	test.describe(`Memory report: ${lane} ${scenario}`, { tag: testTags }, () => {

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

			const baseline = await fetchBaseline(scenario, lane);
			const markdown = renderMarkdown(snapshots, baseline);
			const html = renderHtml(snapshots, baseline);

			mkdirSync(SNAPSHOT_DIR, { recursive: true });
			const htmlPath = join(SNAPSHOT_DIR, 'memory-report.html');
			writeFileSync(htmlPath, html);
			await testInfo.attach('memory-report.html', { path: htmlPath, contentType: 'text/html' });

			// Deliberately only to the job log, not to GITHUB_STEP_SUMMARY: the
			// workflow links the rendered HTML on the CDN instead, and the same
			// table in both places is the copy that goes stale.
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
