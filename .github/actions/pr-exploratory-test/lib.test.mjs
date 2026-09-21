/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReport, buildCostRecord, renderCostFooter, resolveReport, buildShotsBaseUrl } from './lib.mjs';

test('pickReport returns the last message containing a triage table', () => {
	const messages = ['thinking out loud', '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | x | bug |'];
	assert.match(pickReport(messages), /Finding/);
});

test('pickReport returns null when no message looks like a report', () => {
	assert.equal(pickReport(['hello', 'still working']), null);
});

test('pickReport prefers the latest report when several qualify', () => {
	const messages = [
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | first | bug |',
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | second | bug |',
	];
	assert.match(pickReport(messages), /second/);
});

test('buildCostRecord extracts the fields the spec names', () => {
	const record = buildCostRecord({
		type: 'result',
		total_cost_usd: 1.2345,
		num_turns: 87,
		duration_ms: 1500000,
		usage: { input_tokens: 10, output_tokens: 20 },
	});
	assert.equal(record.total_cost_usd, 1.2345);
	assert.equal(record.num_turns, 87);
	assert.equal(record.duration_ms, 1500000);
	assert.equal(record.input_tokens, 10);
	assert.equal(record.output_tokens, 20);
});

test('buildCostRecord tolerates a result message missing usage', () => {
	const record = buildCostRecord({ type: 'result' });
	assert.equal(record.input_tokens, null);
	assert.equal(record.total_cost_usd, null);
});

test('renderCostFooter reports cost, turns against the cap, and wall clock', () => {
	const footer = renderCostFooter({ total_cost_usd: 1.2, num_turns: 87, duration_ms: 1500000 }, 200);
	assert.match(footer, /\$1\.20/);
	assert.match(footer, /87\/200 turns/);
	assert.match(footer, /25m/);
});

test('renderCostFooter degrades gracefully with no result message', () => {
	const footer = renderCostFooter({ total_cost_usd: null, num_turns: null, duration_ms: null }, 200);
	assert.match(footer, /unknown/);
});

test('resolveReport prefers a non-empty report.md over scraped chat text, verbatim', () => {
	const fileReport = '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from file | bug |';
	const messages = ['# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.equal(resolveReport(fileReport, messages), fileReport);
});

test('resolveReport falls back to pickReport when report.md is missing (null)', () => {
	const messages = ['thinking', '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.match(resolveReport(null, messages), /from chat/);
});

test('resolveReport falls back to pickReport when report.md is empty or whitespace-only', () => {
	const messages = ['# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.match(resolveReport('   \n', messages), /from chat/);
});

test('resolveReport returns null when the file is absent and no message looks like a report', () => {
	assert.equal(resolveReport(null, ['hello', 'still working']), null);
});

test('buildShotsBaseUrl passes through a base URL with no trailing slash', () => {
	assert.equal(
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'),
		'https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'
	);
});

test('buildShotsBaseUrl trims exactly one trailing slash', () => {
	assert.equal(
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu/'),
		'https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'
	);
});

test('buildShotsBaseUrl returns empty string when no CDN base is configured', () => {
	assert.equal(buildShotsBaseUrl(''), '');
});
