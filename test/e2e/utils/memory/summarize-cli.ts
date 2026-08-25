/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plain node CLI that turns the three memory-metrics matrix jobs' downloaded
 * artifacts into one cross-scenario summary.
 *
 * Deliberately not a Playwright test: it never launches Positron, never
 * imports the e2e harness, and only reads JSON off disk and writes files. The
 * summarize workflow job that runs this has none of the memory job's
 * requirements (no container image, no Xvfb, no build) precisely because this
 * file does not need them.
 *
 * Usage: node summarize-cli.js <input-dir> <output-html-path>
 *
 * <input-dir> is expected to hold one subdirectory per lane/scenario pair,
 * named memory-report-<lane>-<scenario> (matching the artifact name each
 * matrix job uploads), each containing memory-snapshot-*.json files written
 * by captureSnapshot() in snapshot.ts.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MEMORY_LANES, MemoryLane } from './lanes.js';
import { MEMORY_SCENARIOS, MemoryScenario } from './scenarios.js';
import { buildSummaryMatrix, renderSummaryHtml, ScenarioSnapshots, SummaryMatrix } from './summary.js';
import { escapeHtml, formatBytes, REPORT_CSS } from './report-shell.js';
import { MemorySnapshot } from './types.js';

const ARTIFACT_PREFIX = 'memory-report-';
/** The measure step runs three cold launches; fewer than this means a partial run. */
const EXPECTED_SNAPSHOTS = 3;

export type CollectedScenario = {
	lane: MemoryLane;
	scenario: MemoryScenario;
	snapshots: MemorySnapshot[];
	/** Empty when the scenario is complete; otherwise why it is short. */
	warnings: string[];
};

/**
 * Which scenarios each lane's matrix job actually runs, mirroring the workflow
 * matrix (test-memory-metrics.yml) and scenarios.ts's SPEC_BY_LANE_SCENARIO.
 * Duplicated here rather than imported: this CLI never launches Positron and
 * never imports the e2e harness, and importing the spec map would pull that in.
 */
const EXPECTED_SCENARIOS_BY_LANE: Record<MemoryLane, readonly MemoryScenario[]> = {
	desktop: MEMORY_SCENARIOS,
	server: ['idle']
};

/**
 * Which lane and scenario a matrix job's artifact unpacks to, from
 * `memory-report-<lane>-<scenario>`.
 *
 * The lane in the directory name exists only to keep two jobs' artifacts from
 * colliding, and is used only to locate files. `MemorySnapshot.lane` is
 * authoritative for partitioning: the path is consumed here and discarded
 * before any snapshot is constructed, so a renamed artifact cannot reclassify
 * a measurement.
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

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Walks `inputDir` for `memory-report-<lane>-<scenario>` subdirectories and
 * parses every `memory-snapshot-*.json` inside each one.
 *
 * A missing or short-of-three-launches scenario is collected with a warning
 * rather than thrown: the whole point of this job running with `if: always()`
 * is to still produce a summary when some matrix job failed.
 *
 * A lane with no directories at all is skipped rather than reported as every
 * one of its scenarios missing: that lane's jobs simply were not part of this
 * workflow trigger, which today is true of every lane except the one
 * currently running the matrix.
 */
export function collectScenarios(inputDir: string): CollectedScenario[] {
	let entries: string[];
	try {
		entries = readdirSync(inputDir);
	} catch (error) {
		// No artifacts downloaded at all -- every expected desktop scenario is missing.
		return MEMORY_SCENARIOS.map(scenario => ({
			lane: 'desktop' as MemoryLane,
			scenario,
			snapshots: [],
			warnings: [`could not read ${inputDir}: ${error}`]
		}));
	}

	const found = new Map<MemoryLane, Map<string, string[]>>();
	for (const entry of entries) {
		const path = join(inputDir, entry);
		if (!isDirectory(path)) {
			continue;
		}
		const parsed = laneAndScenarioFromDirName(entry);
		if (parsed === undefined) {
			continue;
		}
		const { lane, scenario } = parsed;
		if (!found.has(lane)) {
			found.set(lane, new Map());
		}
		found.get(lane)!.set(scenario, readdirSync(path).filter(f => /^memory-snapshot-\d+\.json$/.test(f)).map(f => join(path, f)));
	}

	const results: CollectedScenario[] = [];

	for (const lane of MEMORY_LANES) {
		const laneFound = found.get(lane);
		if (laneFound === undefined) {
			continue;
		}

		for (const scenario of EXPECTED_SCENARIOS_BY_LANE[lane]) {
			const files = laneFound.get(scenario);
			const warnings: string[] = [];

			if (files === undefined) {
				warnings.push(`no ${ARTIFACT_PREFIX}${lane}-${scenario} directory found; that matrix job probably failed before uploading`);
				results.push({ lane, scenario, snapshots: [], warnings });
				continue;
			}

			const snapshots: MemorySnapshot[] = [];
			for (const file of files) {
				try {
					snapshots.push(JSON.parse(readFileSync(file, 'utf8')));
				} catch (error) {
					warnings.push(`could not parse ${file}: ${error}`);
				}
			}

			if (snapshots.length < EXPECTED_SNAPSHOTS) {
				warnings.push(`only ${snapshots.length} of ${EXPECTED_SNAPSHOTS} launches found for ${scenario}`);
			}

			// The directory's lane located these files; it plays no further part.
			// Grouping trusts each snapshot's own `lane`, so a directory renamed to
			// the wrong lane cannot relabel the measurement it contains.
			const snapshotLane = snapshots[0]?.lane ?? lane;
			for (const snap of snapshots) {
				if (snap.lane !== snapshotLane) {
					warnings.push(`snapshot lane '${snap.lane}' disagrees with '${snapshotLane}' within ${ARTIFACT_PREFIX}${lane}-${scenario}`);
				}
			}

			results.push({ lane: snapshotLane, scenario, snapshots, warnings });
		}

		// Any directory found for this lane that did not match one of its
		// expected scenarios: surfaced so a typo'd or renamed artifact does not
		// silently disappear.
		for (const scenario of laneFound.keys()) {
			if (!(EXPECTED_SCENARIOS_BY_LANE[lane] as readonly string[]).includes(scenario)) {
				results.push({
					lane,
					scenario: scenario as MemoryScenario,
					snapshots: [],
					warnings: [`unrecognized scenario directory: ${ARTIFACT_PREFIX}${lane}-${scenario}`]
				});
			}
		}
	}

	return results;
}

/**
 * A server total is not comparable to a desktop total: the renderer and GPU
 * processes run in the user's browser, outside the measured tree, so the
 * server tree is missing the roles that dominate the desktop total. Repeated
 * on every server section so a reader landing there directly still sees it.
 */
const SERVER_LANE_NOTE = 'Server lane: the renderer and GPU run in the browser, outside this process tree, so this total is not comparable to the desktop lane.';

/** Compact markdown table for the GitHub step summary: one row per role, one column per scenario with data. */
function renderMarkdownTable(lane: MemoryLane, matrix: SummaryMatrix): string {
	const lines: string[] = [];
	lines.push(`## Memory: ${lane} lane`, '');
	if (lane === 'server') {
		lines.push(SERVER_LANE_NOTE, '');
	}
	lines.push(`| Role | ${matrix.scenarios.join(' | ')} |`);
	// Right-aligned figures, matching the HTML report: the decimal points line up, so a
	// column can be compared down its length without reading each number.
	lines.push(`| --- | ${matrix.scenarios.map(() => '---:').join(' | ')} |`);

	for (const row of matrix.rows) {
		const cells = matrix.scenarios.map(scenario => {
			const value = row.values[scenario];
			if (value === undefined) {
				return '-';
			}
			const delta = row.deltaVsIdle[scenario];
			return delta === undefined || scenario === 'idle'
				? formatBytes(value)
				: `${formatBytes(value)} (${delta >= 0 ? '+' : '-'}${formatBytes(Math.abs(delta))})`;
		});
		lines.push(`| \`${row.role}\` | ${cells.join(' | ')} |`);
	}

	const totalCells = matrix.scenarios.map(scenario => {
		const value = matrix.totals[scenario];
		return value === undefined ? '-' : formatBytes(value);
	});
	lines.push(`| **TOTAL** | ${totalCells.join(' | ')} |`);

	return lines.join('\n');
}

function renderWarningsMarkdown(collected: CollectedScenario[]): string {
	const withWarnings = collected.filter(c => c.warnings.length > 0);
	if (withWarnings.length === 0) {
		return '';
	}
	const lines = ['', '### Notes', ''];
	for (const c of withWarnings) {
		for (const warning of c.warnings) {
			lines.push(`- **${c.lane}/${c.scenario}**: ${warning}`);
		}
	}
	return lines.join('\n');
}

/**
 * One matrix per lane. `buildSummaryMatrix` needs no lane awareness: given
 * only one lane's entries it baselines on that lane's own `idle`, which is
 * exactly the required behaviour. Deltas are therefore within-lane by
 * construction rather than by a check someone could later forget.
 */
export type LaneSection = { lane: MemoryLane; matrix: SummaryMatrix };

export function buildLaneSections(entries: (ScenarioSnapshots & { lane: MemoryLane })[]): LaneSection[] {
	return MEMORY_LANES
		.map(lane => ({ lane, entries: entries.filter(e => e.lane === lane) }))
		.filter(group => group.entries.length > 0)
		.map(group => ({ lane: group.lane, matrix: buildSummaryMatrix(group.entries) }));
}

/**
 * Lifts each lane's `renderSummaryHtml` document down to its inner container
 * markup and stacks the results into one document, rather than nesting N full
 * `<html>` documents into one file. Reuses `renderSummaryHtml` unmodified, so
 * the combined view cannot drift from the per-lane one in styling.
 */
function renderLaneSectionsHtml(sections: LaneSection[]): string {
	const bodies = sections.map(section => {
		const doc = renderSummaryHtml(section.matrix);
		const match = doc.match(/<div class="container">([\s\S]*)<\/div>\s*<\/body>/);
		const inner = match ? match[1] : doc;
		const note = section.lane === 'server' ? `<p class="meta">${escapeHtml(SERVER_LANE_NOTE)}</p>` : '';
		return `<section>
	<h1>${escapeHtml(section.lane)} lane</h1>
	${note}
	${inner}
</section>`;
	});

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: cross-scenario summary</title>
	<style>${REPORT_CSS}</style>
</head>
<body>
${bodies.join('\n')}
</body>
</html>`;
}

export function summarize(inputDir: string, outputHtmlPath: string): { html: string; markdown: string } {
	const collected = collectScenarios(inputDir);

	// idle first, then whatever else has data, in MEMORY_SCENARIOS order; a
	// summary of zero scenarios is possible (every matrix job failed) and must
	// not throw, since this job runs with if: always().
	const entries = collected
		.filter(c => c.snapshots.length > 0)
		.map(c => ({ lane: c.lane, scenario: c.scenario, snapshots: c.snapshots }));

	const sections = buildLaneSections(entries);
	const html = renderLaneSectionsHtml(sections);
	const markdown = sections.map(section => renderMarkdownTable(section.lane, section.matrix)).join('\n\n') + renderWarningsMarkdown(collected);

	writeFileSync(outputHtmlPath, html);

	return { html, markdown };
}

function main(): void {
	const [inputDir, outputHtmlPath] = process.argv.slice(2);
	if (!inputDir || !outputHtmlPath) {
		console.error('usage: node summarize-cli.js <input-dir> <output-html-path>');
		process.exit(1);
	}

	const { markdown } = summarize(inputDir, outputHtmlPath);
	console.log(markdown);
}

// Guarded because this module also exports `collectScenarios` and `summarize`.
// Compiled to CommonJS, an unguarded call runs on any `require` of those exports:
// under Vitest, `process.argv.slice(2)` is something like ['run', 'some.vitest.ts'],
// both truthy, so the argument check passes and `summarize` writes its HTML over
// whatever the second argument names. Nothing imports it today; the guard is here
// so that doing so cannot overwrite a source file.
if (require.main === module) {
	main();
}
