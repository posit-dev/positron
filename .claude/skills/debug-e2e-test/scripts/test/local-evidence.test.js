import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	describeCandidate, rankCandidates, selectCandidate, parseTraceReport,
	buildLocalSummary, matchLogDir, matchesTestFilter,
} from '../collect-local-evidence.js';

const failed = (dir, mtimeMs = 1) => describeCandidate(dir, ['_trace.zip', 'error-context.md', '2-boom.png'], mtimeMs);
const passed = (dir, mtimeMs = 1) => describeCandidate(dir, ['_trace.zip'], mtimeMs);

test('describeCandidate reads failure from error-context, not from the trace', () => {
	assert.deepEqual(failed('a-spec-test-name'), {
		dir: 'a-spec-test-name', mtimeMs: 1, hasTrace: true, failed: true,
		screenshots: ['2-boom.png'], retry: 0,
	});
	// A trace alone is not a failure: local runs keep traces for passing tests.
	assert.equal(passed('a-spec-test-name').failed, false);
	assert.equal(describeCandidate('a-spec-retry1', ['_trace.zip'], 1).retry, 1);
});

test('rankCandidates puts failures first, then newest', () => {
	const ranked = rankCandidates([passed('new-pass', 300), failed('old-fail', 100), failed('new-fail', 200)]);
	assert.deepEqual(ranked.map(c => c.dir), ['new-fail', 'old-fail', 'new-pass']);
});

test('selectCandidate distinguishes nothing-ran from nothing-failed', () => {
	assert.equal(selectCandidate([]).verdict, 'no-results');
	assert.equal(selectCandidate([passed('p', 1)]).verdict, 'no-failure');
	assert.equal(selectCandidate([failed('f', 1)]).verdict, 'ok');
	// A filter matching nothing is the same dead end as an empty dir.
	assert.equal(selectCandidate([failed('f', 1)], { test: 'other' }).verdict, 'no-results');
});

test('matchesTestFilter matches through Playwright slugging and truncation', () => {
	// Playwright's real directory shape: hyphenated title with the middle elided.
	const dir = 'tests-variables-variables--d5e2d-ons-of-the-same-interpreter-e2e-electron';
	// Spaces in the filter are hyphens in the directory.
	assert.equal(matchesTestFilter(dir, 'same interpreter'), true);
	// The full title never appears verbatim; a surviving tail suffix still resolves.
	assert.equal(matchesTestFilter(dir, 'Validate variables are isolated between two sessions of the same interpreter'), true);
	assert.equal(matchesTestFilter(dir, 'a completely different test'), false);
	// A short filter typed deliberately matches on its own, below the suffix floor.
	assert.equal(matchesTestFilter('plots-one', 'plots'), true);
});

test('selectCandidate asks rather than guessing when a filter is ambiguous', () => {
	const cands = [passed('plots-one', 2), passed('plots-two', 1)];
	assert.equal(selectCandidate(cands, { test: 'plots' }).verdict, 'ambiguous');
	// ...but an unfiltered call defaults to the best-ranked run: the low-friction case.
	assert.equal(selectCandidate(cands).verdict, 'no-failure');
	// Exactly one failure among the matches resolves it without a question.
	const withFail = [passed('plots-one', 2), failed('plots-two', 1)];
	assert.equal(selectCandidate(withFail, { test: 'plots' }).selected.dir, 'plots-two');
	// Two failures do not: newest-wins there is the guess this verdict avoids.
	const twoFails = [failed('plots-one', 2), failed('plots-two', 1), passed('plots-three', 3)];
	assert.equal(selectCandidate(twoFails, { test: 'plots' }).verdict, 'ambiguous');
});

test('parseTraceReport splits the analyzer sections and mines error lines', () => {
	const stdout = [
		'=== Action Timeline (last 3 of 40 events) ===',
		'',
		'[before] locator.click',
		'[after]  ERROR: timeout',
		'=== Screenshots ===',
		'Total screencast frames: 12',
		'=== Errors (2) ===',
		'- toBeVisible timeout: getByRole("row")',
		'- second error',
	].join('\n');
	const parsed = parseTraceReport(stdout);
	assert.deepEqual(parsed.timeline, ['[before] locator.click', '[after]  ERROR: timeout']);
	assert.deepEqual(parsed.errors, ['toBeVisible timeout: getByRole("row")', 'second error']);
	assert.deepEqual(parsed.sections, ['Action Timeline', 'Screenshots', 'Errors']);
	assert.deepEqual(parseTraceReport('').errors, []);
});

test('buildLocalSummary keeps the CI summary headings and flags what local cannot fill', () => {
	const { markdown, failure } = buildLocalSummary({
		selected: failed('spec-dir'), timeline: ['[after] ERROR: boom'],
		errors: ['boom'], snapshotFile: null, logDir: null,
	});
	assert.equal(failure, 'boom');
	for (const heading of ['## Failure', '## Timeline tail', '## Sibling tests', '## Error-shaped log lines', '## Unresolved questions']) {
		assert.ok(markdown.includes(heading), `missing ${heading}`);
	}
	// A passing run's trailing trace error is never presented as "the failure".
	const passing = buildLocalSummary({
		selected: passed('spec-dir'), timeline: [], errors: ['Timeout 1000ms exceeded.'],
		snapshotFile: null, logDir: null,
	});
	assert.match(passing.markdown, /this run passed; its trace's last logged error, non-fatal/);

	// The two gaps are stated, never faked.
	assert.match(markdown, /sibling outcomes are unknown/);
	assert.match(markdown, /No error-context snapshot was written/);
	assert.match(markdown, /No CI history was queried/);
});

test('buildLocalSummary prefers error-context.md details over the trace error stub', () => {
	// Same gap as the CI entry: the trace reduces the assertion to a stub, while
	// error-context.md carries the locator and the matched elements.
	const errorDetails = [
		'Error: expect(locator).toBeVisible() failed',
		'',
		"Locator: getByText('Browse[1]>')",
		"Error: strict mode violation: getByText('Browse[1]>') resolved to 2 elements:",
		'    1) <span>Browse[1]> </span>',
		'    2) <div class="line-numbers active-line-number">Browse[1]></div>',
	].join('\n');
	const { markdown, failure } = buildLocalSummary({
		selected: failed('spec-dir'), timeline: ['[after] ERROR: Expect failed'],
		errors: ['Expect failed'], errorDetails, snapshotFile: 'error-context.md', logDir: null,
	});
	assert.match(failure, /strict mode violation/);
	assert.match(markdown, /strict mode violation/);
});

test('buildLocalSummary falls back to the trace error when no error-context details exist', () => {
	const { failure } = buildLocalSummary({
		selected: failed('spec-dir'), timeline: [], errors: ['Expect failed'],
		errorDetails: null, snapshotFile: null, logDir: null,
	});
	assert.equal(failure, 'Expect failed');
});

test('matchLogDir pairs on the spec prefix, surviving Playwright\'s truncated dir names', () => {
	const logDirs = [
		'e2e-workbench',
		'e2e-workbench/tests/connect/pins-data-connection.test.ts',
		'e2e-workbench/tests/connect/other.test.ts',
	];
	// The results dir truncates the spec and injects a hash, so no full segment of
	// the log path is a substring of it -- only a prefix matches.
	assert.equal(
		matchLogDir('tests-connect-pins-data-co-baff7-browse-its-pins-in-the-tree-e2e-workbench', logDirs),
		'e2e-workbench/tests/connect/pins-data-connection.test.ts',
	);
	// The bare project dir is never the answer: it holds no spec's logs.
	assert.equal(matchLogDir('tests-connect-pins-data-co-baff7-x-e2e-workbench', ['e2e-workbench']), null);
	// A different spec shares too short a prefix, and a different project is excluded outright.
	assert.equal(matchLogDir('tests-notebooks-add-a-cell-e2e-workbench', logDirs), null);
	assert.equal(matchLogDir('tests-connect-pins-data-co-baff7-x-e2e-electron', logDirs), null);
});
