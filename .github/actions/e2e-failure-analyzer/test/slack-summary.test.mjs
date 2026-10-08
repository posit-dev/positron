/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with:
//   node --test ".github/actions/e2e-failure-analyzer/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketRootCause, parseSummaryRootCauses, renderSlackSummary } from '../slack-summary.mjs';

// Shape of a real report (posit-dev/positron run 37667303282), trimmed.
const REPORT = [
	'## Summary',
	'',
	'| Test | Platform | Root cause | Severity |',
	'|------|----------|------------|----------|',
	'| Python - queue user input while interpreter is starting | e2e-chromium / ubuntu | flaky test (queued-input startup race) | hard |',
	'| R - Flags an installed package with an unscored CRAN advisory | e2e-chromium / ubuntu | test logic bug (under-budgeted install wait) | hard |',
	'| R - Flags an installed package with an unscored CRAN advisory | e2e-electron / ubuntu | test logic bug (under-budgeted install wait) | hard |',
	'',
	'## Detailed Analysis',
	'',
	'| not | a | summary | row |',
].join('\r\n');

test('parseSummaryRootCauses reads only the Summary table root-cause column', () => {
	assert.deepEqual(parseSummaryRootCauses(REPORT), [
		'flaky test (queued-input startup race)',
		'test logic bug (under-budgeted install wait)',
		'test logic bug (under-budgeted install wait)',
	]);
});

test('parseSummaryRootCauses handles escaped pipes and a missing table', () => {
	const report = '## Summary\n\n| Test | Root cause |\n|---|---|\n| a \\| b | product regression |\n';
	assert.deepEqual(parseSummaryRootCauses(report), ['product regression']);
	assert.deepEqual(parseSummaryRootCauses('## Summary\n\nNo table here.\n'), []);
	assert.deepEqual(parseSummaryRootCauses(''), []);
});

test('bucketRootCause uses the leading category, not one mentioned in the parenthetical', () => {
	assert.deepEqual(
		[
			'product regression',
			'suspected product regression (low confidence)',
			'locator drift / stale selector',
			'test environment issue (save target path does not exist)',
			'test logic bug (not an infrastructure issue)',
			'flaky test (external-provider response timeout)',
			'infrastructure issue (setup step failed)',
			'timeout',
			'something new',
		].map(bucketRootCause),
		[
			{ bucket: 'product', suspected: false },
			{ bucket: 'product', suspected: true },
			{ bucket: 'test', suspected: false },
			{ bucket: 'test', suspected: false },
			{ bucket: 'test', suspected: false },
			{ bucket: 'flaky', suspected: false },
			{ bucket: 'infra', suspected: false },
			{ bucket: 'other', suspected: false },
			{ bucket: 'other', suspected: false },
		],
	);
});

test('renderSlackSummary', () => {
	assert.deepEqual(
		[
			renderSlackSummary(parseSummaryRootCauses(REPORT), 2),
			renderSlackSummary(['product regression'], 1),
			renderSlackSummary(['suspected product regression', 'product regression', 'infrastructure issue', 'timeout'], 0),
			renderSlackSummary(['suspected product regression', 'suspected product regression'], 0),
			renderSlackSummary([], 3),
		],
		[
			'2 test issues, 1 flaky failure. 2 tests passed on retry.',
			'1 product issue. 1 test passed on retry.',
			'2 product issues (1 suspected), 1 infra issue, 1 unclassified.',
			'2 product issues (suspected).',
			'',
		],
	);
});
