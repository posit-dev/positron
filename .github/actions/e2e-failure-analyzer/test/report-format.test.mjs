/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with:
//   node --test ".github/actions/e2e-failure-analyzer/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRootCause, decorateReport, parseSummaryRootCauses, renderSlackSummary } from '../report-format.mjs';

// Shape of a real report (posit-dev/positron run 37667303282), trimmed. Uses the
// older table layout (parentheticals, Severity column) that decorateReport must
// still normalize, and CRLF line endings.
const REPORT = [
	'## Summary',
	'',
	'| Test | Platform | Root cause | Severity |',
	'|------|----------|------------|----------|',
	'| Python - queue user input while interpreter is starting | e2e-chromium / ubuntu | suspected product regression (low confidence) | hard |',
	'| R - Flags an installed package with an unscored CRAN advisory | e2e-chromium / ubuntu | test logic bug (pak apt-get stall) | hard |',
	'| R - Flags an installed package with an unscored CRAN advisory | e2e-electron / ubuntu | test logic bug (pak apt-get stall) | hard |',
	'',
	'## Detailed Analysis',
	'',
	'### Python - queue user input while interpreter is starting',
	'',
	'| not | a | summary | row |',
	'',
	'---',
	'',
	'### R - Flags an installed package with an unscored CRAN advisory',
	'',
	'## Flaky (passed on retry)',
	'',
	'### Not a Detailed Analysis heading',
].join('\r\n');

test('parseSummaryRootCauses reads only the Summary table root-cause column', () => {
	assert.deepEqual(parseSummaryRootCauses(REPORT), [
		'suspected product regression (low confidence)',
		'test logic bug (pak apt-get stall)',
		'test logic bug (pak apt-get stall)',
	]);
});

test('parseSummaryRootCauses handles escaped pipes and a missing table', () => {
	const report = '## Summary\n\n| Test | Root cause |\n|---|---|\n| a \\| b | product regression |\n';
	assert.deepEqual(parseSummaryRootCauses(report), ['product regression']);
	assert.deepEqual(parseSummaryRootCauses('## Summary\n\nNo table here.\n'), []);
	assert.deepEqual(parseSummaryRootCauses(''), []);
});

test('classifyRootCause uses the leading category, not one mentioned in the parenthetical', () => {
	assert.deepEqual(
		[
			'product regression',
			'suspected product regression (low confidence)',
			'stale selector',
			'test environment issue (save target path does not exist)',
			'test logic bug (not an infrastructure issue)',
			'flaky test (external-provider response timeout)',
			'infrastructure issue (setup step failed)',
			'timeout',
			'something new',
		].map(classifyRootCause),
		[
			{ bucket: 'product', suspected: false, label: 'product regression' },
			{ bucket: 'product', suspected: true, label: 'suspected product regression' },
			{ bucket: 'test', suspected: false, label: 'locator drift / stale selector' },
			{ bucket: 'test', suspected: false, label: 'test environment issue' },
			{ bucket: 'test', suspected: false, label: 'test logic bug' },
			{ bucket: 'flaky', suspected: false, label: 'flaky test' },
			{ bucket: 'infra', suspected: false, label: 'infrastructure issue' },
			{ bucket: 'other', suspected: false, label: 'timeout' },
			{ bucket: 'other', suspected: false, label: 'something new' },
		],
	);
});

test('renderSlackSummary', () => {
	assert.deepEqual(
		[
			renderSlackSummary(['flaky test', 'test logic bug', 'test logic bug']),
			renderSlackSummary(['product regression']),
			renderSlackSummary(['suspected product regression', 'product regression', 'infrastructure issue', 'timeout']),
			renderSlackSummary(['suspected product regression', 'suspected product regression']),
			renderSlackSummary([]),
		],
		[
			'2 test issues, 1 flaky failure.',
			'1 product issue.',
			'2 product issues (1 suspected), 1 infra issue, 1 unclassified.',
			'2 product issues (suspected).',
			'',
		],
	);
});

test('decorateReport adds the callout, table icons, legend, and heading icons', () => {
	const result = decorateReport(REPORT, { flakyCount: 2, note: 'Analysis run: `claude-opus-5-5`, 14 turns, $0.65' });
	assert.deepEqual(result, {
		slack: '1 product issue (suspected), 2 test issues.',
		report: [
			'> [!CAUTION]',
			'> **1 product issue (suspected)**, 2 test issues. 2 tests passed on retry.',
			'',
			'## Summary',
			'',
			'| | Test | Platform | Root cause |',
			'|---|------|----------|------------|',
			'| :red_circle: | Python - queue user input while interpreter is starting | e2e-chromium / ubuntu | suspected product regression |',
			'| :yellow_circle: | R - Flags an installed package with an unscored CRAN advisory | e2e-chromium / ubuntu | test logic bug |',
			'| :yellow_circle: | R - Flags an installed package with an unscored CRAN advisory | e2e-electron / ubuntu | test logic bug |',
			'',
			'<sub>:red_circle: product &middot; :yellow_circle: test &nbsp;|&nbsp; Analysis run: `claude-opus-5-5`, 14 turns, $0.65</sub>',
			'',
			'## Detailed Analysis',
			'',
			'### :red_circle: Python - queue user input while interpreter is starting',
			'',
			'| not | a | summary | row |',
			'',
			'---',
			'',
			'### :yellow_circle: R - Flags an installed package with an unscored CRAN advisory',
			'',
			'## Flaky (passed on retry)',
			'',
			'### Not a Detailed Analysis heading',
		].join('\n'),
	});
});

test('decorateReport uses a NOTE callout without product issues, and leaves an unparseable report alone', () => {
	const testOnly = decorateReport('## Summary\n\n| Test | Platform | Root cause |\n|---|---|---|\n| a | linux | infrastructure issue |\n', { flakyCount: 0, note: 'n' });
	assert.deepEqual(testOnly.report.split('\n').slice(0, 2), ['> [!NOTE]', '> 1 infra issue.']);

	assert.deepEqual(
		decorateReport('## Summary\n\nNo table.\n', { flakyCount: 1, note: 'n' }),
		{ report: '## Summary\n\nNo table.\n\n<sub>n</sub>\n', slack: '' },
	);
});
