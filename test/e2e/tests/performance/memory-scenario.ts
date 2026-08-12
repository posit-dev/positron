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
			// Only test-memory-metrics.yml collects these specs, and it always sets
			// BUILD. A missing one means the workflow is broken, not that the spec
			// ran somewhere it should not have.
			const buildRoot = process.env.BUILD;
			expect(buildRoot, 'BUILD must point at a Positron build; memory numbers from a dev build are meaningless').toBeTruthy();

			const mainPid = app.code.electronApp?.process().pid;
			expect(mainPid, 'no Electron main pid; this spec only runs against Electron').toBeTruthy();

			if (prepare) {
				await prepare({ app, sessions });
			}

			// Deterministic readiness gate, not a memory heuristic: waits out startup
			// banners (session or otherwise), focuses the console, and parks the mouse
			// so a hover tooltip is not holding renderer allocations. Runs for every
			// scenario, including idle, so idle stays comparable to the states it is
			// the baseline for. waitForSettle below still guards a tree that is
			// genuinely mid-allocation.
			await app.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
			await sessions.expectNoStartUpMessaging();

			// --- Start temporary diagnostic ---
			// Investigating a bimodal renderer PSS split (~430 MB vs ~595 MB) across
			// otherwise-identical launches. Leading hypothesis is a raster/compositing
			// buffer size difference driven by window dimensions or devicePixelRatio.
			// Remove once the split is explained. Must never fail the measurement.
			const launchIndex = Number(process.env.MEMORY_LAUNCH_INDEX ?? 0);
			try {
				const rendererContext = await app.code.driver.currentPage.evaluate(() => ({
					innerWidth: window.innerWidth,
					innerHeight: window.innerHeight,
					outerWidth: window.outerWidth,
					outerHeight: window.outerHeight,
					devicePixelRatio: window.devicePixelRatio,
					screenWidth: window.screen.width,
					screenHeight: window.screen.height
				}));
				mkdirSync(SNAPSHOT_DIR, { recursive: true });
				writeFileSync(join(SNAPSHOT_DIR, `launch-${launchIndex}-context.json`), JSON.stringify(rendererContext, null, 2));
				console.log(`[memory] ${scenario} launch ${launchIndex} renderer context: inner=${rendererContext.innerWidth}x${rendererContext.innerHeight} outer=${rendererContext.outerWidth}x${rendererContext.outerHeight} dpr=${rendererContext.devicePixelRatio} screen=${rendererContext.screenWidth}x${rendererContext.screenHeight}`);
			} catch (error) {
				console.log(`[memory] ${scenario} launch ${launchIndex}: failed to capture renderer context diagnostic: ${error}`);
			}

			try {
				mkdirSync(SNAPSHOT_DIR, { recursive: true });
				await app.code.driver.currentPage.screenshot({ path: join(SNAPSHOT_DIR, `launch-${launchIndex}.png`), fullPage: true });
			} catch (error) {
				console.log(`[memory] ${scenario} launch ${launchIndex}: failed to capture screenshot diagnostic: ${error}`);
			}
			// --- End temporary diagnostic ---

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

			// waitForSettle gives up at its cap regardless of whether the tree
			// actually stopped growing. A settleMs near the cap means this snapshot
			// is a mid-load number, not the steady state the scenario claims.
			expect(snapshot.settleMs, 'the tree never settled before the cap, so this is a mid-load number rather than a steady state').toBeLessThan(85_000);

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
