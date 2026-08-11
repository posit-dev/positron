/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect, tags, test } from '../_test.setup';
import { readActivatedExtensions } from '../../utils/memory/extensions.js';
import { fetchBaseline, publishSnapshots } from '../../utils/memory/publish.js';
import { renderHtml, renderMarkdown } from '../../utils/memory/render.js';
import { captureSnapshot } from '../../utils/memory/snapshot.js';
import { MemorySnapshot } from '../../utils/memory/types.js';

test.use({
	suiteId: __filename
});

/**
 * Snapshots must outlive a single Playwright invocation: three separate
 * `npx playwright test` runs write here and a fourth reads them back.
 *
 * Deliberately NOT under `test-results/`. Playwright's outputDir defaults to
 * `test-results` and is wiped at the start of every run, so launch 1 would
 * delete launch 0's snapshot and the aggregation run would delete all three.
 * RUNNER_TEMP persists for the whole job.
 */
const SNAPSHOT_DIR = join(process.env.RUNNER_TEMP ?? '/tmp', 'memory-snapshots');

/**
 * Above the job's own `timeout-minutes: 45`, so anything older than this cannot
 * have come from the run doing the rendering.
 */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

test.describe('Memory: idle', { tag: [tags.PERFORMANCE] }, () => {

	test('Idle memory footprint of the Positron process tree', async function ({ app, logsPath }) {
		// Only test-memory-metrics.yml collects this spec (see playwright.config.ts)
		// and it always sets BUILD, so a missing one is a broken workflow.
		const buildRoot = process.env.BUILD;
		expect(buildRoot, 'BUILD must point at a Positron build; memory numbers from a dev build are meaningless').toBeTruthy();

		const mainPid = app.code.electronApp?.process().pid;
		expect(mainPid, 'no Electron main pid; this spec only runs against Electron').toBeTruthy();

		// The harness passes --logsPath, so take the root from that same fixture
		// rather than the default state dir. See Task 6.
		const extensions = await readActivatedExtensions({
			logsRoot: logsPath,
			extensionsDir: app.extensionsPath
		});

		const snapshot = await captureSnapshot({
			rootPid: mainPid!,
			buildRoot: buildRoot!,
			userDataDir: app.userDataPath,
			launchIndex: Number(process.env.MEMORY_LAUNCH_INDEX ?? 0),
			extensions
		});

		// A tree that reports nothing means the procfs read failed, which would
		// otherwise publish a convincing-looking zero.
		expect(snapshot.processes.length, 'no processes found in the tree').toBeGreaterThan(3);
		expect(snapshot.treeTotalPssBytes, 'total PSS was zero; smaps_rollup is probably unreadable').toBeGreaterThan(0);
		expect(snapshot.positronVersion, 'could not read positronVersion from the build\'s product.json').toBeTruthy();

		// Quality gate. Every component here fails soft, which is right for a
		// report but wrong for a baseline: if `--status` silently returns
		// nothing, we would publish a plausible-looking total built entirely
		// from guesses. Refuse to record data we cannot attribute.
		const namedShare = snapshot.processes.filter(p => p.labeled).length / snapshot.processes.length;
		expect(namedShare, 'Positron named too few processes; --status probably failed, and an unattributable total is worse than no data').toBeGreaterThan(0.5);

		const unlabeledBytes = snapshot.processes
			.filter(p => p.processRole === 'unlabeled')
			.reduce((sum, p) => sum + p.pssBytes, 0);
		expect(unlabeledBytes / snapshot.treeTotalPssBytes, 'more than a third of memory is unattributed; add rules to label.ts').toBeLessThan(0.34);

		// Extensions activate in every normal run (a verified launch logged 32),
		// so an empty inventory means the log was not found rather than that
		// nothing activated.
		expect(snapshot.extensions.length, 'no activated extensions found; findExtHostLog probably looked in the wrong logsRoot').toBeGreaterThan(0);

		mkdirSync(SNAPSHOT_DIR, { recursive: true });
		writeFileSync(join(SNAPSHOT_DIR, `memory-snapshot-${snapshot.launchIndex}.json`), JSON.stringify(snapshot, null, 2));

		console.log(`[memory] launch ${snapshot.launchIndex}: ${(snapshot.treeTotalPssBytes / 1048576).toFixed(1)} MB PSS across ${snapshot.processes.length} processes, settled in ${snapshot.settleMs} ms`);
	});
});

/**
 * Aggregation runs after all launches. Reads whatever snapshot files exist,
 * renders the report, and publishes.
 *
 * Kept separate from the measuring test so a failure to render or publish
 * cannot lose the measurement, which is the expensive part.
 */
test.describe('Memory: report', { tag: [tags.PERFORMANCE] }, () => {

	test('Render and publish the idle memory report', async function ({ }, testInfo) {
		// Require all three. Reporting a "median" over one surviving launch
		// would look identical to a healthy run while telling us nothing about
		// variance, which is the whole reason we launch three times.
		//
		// Checked before reading, so a missing launch fails with the path that is
		// missing rather than a bare ENOENT from readFileSync.
		const paths = [0, 1, 2].map(i => join(SNAPSHOT_DIR, `memory-snapshot-${i}.json`));
		const missing = paths.filter(path => !existsSync(path));
		expect(missing, `missing snapshot(s); a measure step probably failed: ${missing.join(', ')}`).toEqual([]);

		const snapshots: MemorySnapshot[] = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));

		// Outside CI, SNAPSHOT_DIR falls back to /tmp and survives between runs, so an
		// earlier run's files would otherwise render as a healthy-looking report. A
		// malformed capturedAt counts as stale rather than parsing to NaN and passing.
		const stale = snapshots.filter(({ capturedAt }) => {
			const ageMs = Date.now() - Date.parse(capturedAt);
			return !Number.isFinite(ageMs) || ageMs > MAX_SNAPSHOT_AGE_MS;
		});
		expect(stale.map(s => `launch ${s.launchIndex} at ${s.capturedAt}`),
			'stale snapshot(s); these are from an earlier run, so re-run the measure steps').toEqual([]);

		// The report names only launch 0's build, so a median spanning two builds would
		// look healthy while describing neither.
		const versions = [...new Set(snapshots.map(s => s.positronVersion))];
		expect(versions, 'launches measured different builds; the median would be meaningless').toHaveLength(1);

		const baseline = await fetchBaseline();
		const markdown = renderMarkdown(snapshots, baseline);
		const html = renderHtml(snapshots, baseline);

		mkdirSync(SNAPSHOT_DIR, { recursive: true });
		const htmlPath = join(SNAPSHOT_DIR, 'memory-report.html');
		writeFileSync(htmlPath, html);
		// Also attach it. RUNNER_TEMP is not collected as a CI artifact by default,
		// so a job that dies before the upload step would otherwise lose the report;
		// Playwright collects attachments even on failure.
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
