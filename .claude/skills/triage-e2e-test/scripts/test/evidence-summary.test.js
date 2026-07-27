import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReportUrl, buildEvidenceSummary } from '../fetch-pattern-evidence.js';

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
