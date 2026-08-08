import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeReportUrl, buildEvidenceSummary, clearManagedArtifacts } from '../fetch-pattern-evidence.js';

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

test('clearManagedArtifacts drops a previous occurrence\'s artifacts, including raw-logs', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-evidence-'));
	fs.mkdirSync(path.join(dir, 'raw-logs', 'julyrun'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'summary.md'), 'stale');
	fs.writeFileSync(path.join(dir, 'notes-by-hand.md'), 'keep me');

	const cleared = clearManagedArtifacts(dir);

	assert.deepEqual(cleared.sort(), ['raw-logs', 'summary.md']);
	assert.equal(fs.existsSync(path.join(dir, 'raw-logs')), false);
	// Anything the script does not own is left alone.
	assert.equal(fs.readFileSync(path.join(dir, 'notes-by-hand.md'), 'utf8'), 'keep me');
	assert.deepEqual(clearManagedArtifacts(dir), [], 'second call is a no-op');
	fs.rmSync(dir, { recursive: true, force: true });
});
