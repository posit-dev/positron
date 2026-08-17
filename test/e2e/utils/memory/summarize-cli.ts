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
 * <input-dir> is expected to hold one subdirectory per scenario, named
 * memory-report-<scenario> (matching the artifact name each matrix job
 * uploads), each containing memory-snapshot-*.json files written by
 * captureSnapshot() in snapshot.ts.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MEMORY_SCENARIOS, MemoryScenario } from './scenarios.js';
import { buildSummaryMatrix, renderSummaryHtml, ScenarioSnapshots, SummaryMatrix } from './summary.js';
import { formatBytes } from './report-shell.js';
import { MemorySnapshot } from './types.js';

const ARTIFACT_PREFIX = 'memory-report-';
/** The measure step runs three cold launches; fewer than this means a partial run. */
const EXPECTED_SNAPSHOTS = 3;

export type CollectedScenario = {
	scenario: MemoryScenario;
	snapshots: MemorySnapshot[];
	/** Empty when the scenario is complete; otherwise why it is short. */
	warnings: string[];
};

/**
 * Which scenario directory a matrix job's artifact unpacks to. Not restricted
 * to `MEMORY_SCENARIOS`: an unrecognized directory is reported as a warning
 * rather than silently ignored, so a renamed artifact does not vanish without
 * a trace.
 */
function scenarioFromDirName(name: string): string | undefined {
	if (!name.startsWith(ARTIFACT_PREFIX)) {
		return undefined;
	}
	return name.slice(ARTIFACT_PREFIX.length);
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Walks `inputDir` for `memory-report-<scenario>` subdirectories and parses
 * every `memory-snapshot-*.json` inside each one.
 *
 * A missing or short-of-three-launches scenario is collected with a warning
 * rather than thrown: the whole point of this job running with `if: always()`
 * is to still produce a two-scenario summary when the third matrix job failed.
 */
export function collectScenarios(inputDir: string): CollectedScenario[] {
	const results: CollectedScenario[] = [];

	let entries: string[];
	try {
		entries = readdirSync(inputDir);
	} catch (error) {
		// No artifacts downloaded at all -- every expected scenario is missing.
		return MEMORY_SCENARIOS.map(scenario => ({
			scenario,
			snapshots: [],
			warnings: [`could not read ${inputDir}: ${error}`]
		}));
	}

	const found = new Map<string, string[]>();
	for (const entry of entries) {
		const path = join(inputDir, entry);
		if (!isDirectory(path)) {
			continue;
		}
		const scenario = scenarioFromDirName(entry);
		if (scenario === undefined) {
			continue;
		}
		found.set(scenario, readdirSync(path).filter(f => /^memory-snapshot-\d+\.json$/.test(f)).map(f => join(path, f)));
	}

	for (const scenario of MEMORY_SCENARIOS) {
		const files = found.get(scenario);
		const warnings: string[] = [];

		if (files === undefined) {
			warnings.push(`no ${ARTIFACT_PREFIX}${scenario} directory found; that matrix job probably failed before uploading`);
			results.push({ scenario, snapshots: [], warnings });
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

		results.push({ scenario, snapshots, warnings });
	}

	// Any directory that did not match a known scenario name at all: surfaced
	// so a typo'd or renamed artifact does not silently disappear.
	for (const entry of entries) {
		const path = join(inputDir, entry);
		if (!isDirectory(path)) {
			continue;
		}
		const scenario = scenarioFromDirName(entry);
		if (scenario !== undefined && !(MEMORY_SCENARIOS as readonly string[]).includes(scenario)) {
			results.push({ scenario: scenario as MemoryScenario, snapshots: [], warnings: [`unrecognized scenario directory: ${entry}`] });
		}
	}

	return results;
}

/** Compact markdown table for the GitHub step summary: one row per role, one column per scenario with data. */
function renderMarkdownTable(matrix: SummaryMatrix): string {
	const lines: string[] = [];
	lines.push('## Memory: cross-scenario summary', '');
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
			lines.push(`- **${c.scenario}**: ${warning}`);
		}
	}
	return lines.join('\n');
}

export function summarize(inputDir: string, outputHtmlPath: string): { html: string; markdown: string } {
	const collected = collectScenarios(inputDir);

	// idle first, then whatever else has data, in MEMORY_SCENARIOS order; a
	// summary of zero scenarios is possible (every matrix job failed) and must
	// not throw, since this job runs with if: always().
	const entries: ScenarioSnapshots[] = collected
		.filter(c => c.snapshots.length > 0)
		.map(c => ({ scenario: c.scenario, snapshots: c.snapshots }));

	const matrix = buildSummaryMatrix(entries);
	const html = renderSummaryHtml(matrix);
	const markdown = renderMarkdownTable(matrix) + renderWarningsMarkdown(collected);

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
