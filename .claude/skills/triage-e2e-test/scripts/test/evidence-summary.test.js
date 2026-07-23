import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReportUrl, buildEvidenceSummary, parseKeptRawLogDir, buildEvidenceManifest, MAX_FAILURE_CHARS } from '../fetch-pattern-evidence.js';

test('buildEvidenceManifest keeps stdout compact: paths + capped failure, no raw payload', () => {
	const huge = 'x'.repeat(50_000);
	const m = buildEvidenceManifest({
		evidenceDir: '/w/evidence/A',
		summaryFile: '/w/evidence/A/summary.md',
		timelineFile: null,
		snapshotFile: null,
		screenshots: ['/w/a.jpeg', '/w/b.jpeg'],
		rawLogDir: null,
		rawEvidenceFile: '/w/evidence/A/evidence-raw.json',
		failure: huge,
	});
	// Failure is capped; the ~50KB input can't inflate the manifest.
	assert.equal(m.failure.length, MAX_FAILURE_CHARS);
	assert.ok(JSON.stringify(m).length < 1000, 'manifest must stay small and carry no raw payload');
	// Exactly the manifest keys -- no accidental spread of the raw result object.
	assert.deepEqual(
		Object.keys(m).sort(),
		['evidenceDir', 'failure', 'rawEvidenceFile', 'rawLogDir', 'screenshots', 'snapshotFile', 'summaryFile', 'timelineFile'],
	);
});

test('parseKeptRawLogDir extracts the kept temp dir path from analyzer stderr', () => {
	const stderr = 'Processing trace...\n(temp dir kept at /var/folders/x/e2e-process-s3-ab12cd34 -- pass --cleanup to remove)\n';
	assert.equal(parseKeptRawLogDir(stderr), '/var/folders/x/e2e-process-s3-ab12cd34');
	// No kept-dir line (e.g. --cleanup was passed) -> null.
	assert.equal(parseKeptRawLogDir('Done. 3 attempts processed.\n'), null);
	assert.equal(parseKeptRawLogDir(''), null);
});

test('normalizeReportUrl strips index.html + fragment and extracts testId', () => {
	const url = 'https://cf.net/playwright-report-1-2-ubuntu/index.html#?testId=abc123-def';
	const { baseUrl, testId } = normalizeReportUrl(url);
	assert.equal(baseUrl, 'https://cf.net/playwright-report-1-2-ubuntu/');
	assert.equal(testId, 'abc123-def');
});

test('normalizeReportUrl handles a bare directory URL with no fragment', () => {
	const { baseUrl, testId } = normalizeReportUrl('https://cf.net/report/');
	assert.equal(baseUrl, 'https://cf.net/report/');
	assert.equal(testId, null);
});

test('buildEvidenceSummary produces a compact markdown summary from the processor result', () => {
	const result = {
		failures: ['Error: outer'],
		testDetails: [{
			testId: 't1',
			title: 'opens a file',
			siblingTests: [{ title: 'closes a file', status: 'passed' }],
			logExcerpt: 'ExtensionHost terminated unexpectedly',
			attempts: [{
				attemptIndex: 0,
				errorContextPath: '/work/error-context/t1.md',
				screenshotPaths: ['/work/screenshots/t1.jpeg'],
				trace: {
					timeline: Array.from({ length: 40 }, (_, i) => `[before] step${i}`).join('\n'),
					errors: ['Error: toBeVisible timeout'],
				},
			}],
		}],
	};
	const s = buildEvidenceSummary(result, { testId: 't1' });
	assert.equal(s.failure, 'Error: toBeVisible timeout');
	assert.equal(s.snapshotFile, '/work/error-context/t1.md');
	assert.deepEqual(s.screenshots, ['/work/screenshots/t1.jpeg']);
	assert.match(s.markdown, /## Failure/);
	assert.match(s.markdown, /toBeVisible timeout/);
	assert.match(s.markdown, /closes a file \(passed\)/);
	assert.match(s.markdown, /ExtensionHost terminated/);
	// Timeline tail is a bounded slice (14 lines), not the whole 40-line timeline.
	assert.match(s.markdown, /step39/);
	assert.doesNotMatch(s.markdown, /step10\b/);
});

test('buildEvidenceSummary is graceful when no matching detail exists', () => {
	const s = buildEvidenceSummary({ testDetails: [] }, { testId: 'missing' });
	assert.match(s.markdown, /No matching test detail/);
	assert.equal(s.failure, null);
});
