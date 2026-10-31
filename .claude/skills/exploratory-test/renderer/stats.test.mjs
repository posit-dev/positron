/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problem } from './lint/lint-rules.mjs';
import { withLogsRun, withTmpDir } from './shared/tmp-dirs.mjs';
import { buildStats, CHECKS_FILE, readChecks, recordCheck, statsFromLog, summarizeByVersion, summarizeChecks } from './stats.mjs';

// The renders these tests spawn must not post usage rows.
process.env.EXPLORATORY_TEST_NO_USAGE = '1';

const LINT_JSON = fileURLToPath(new URL('./lint-json.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./stats.mjs', import.meta.url));

test('recordCheck and summarizeChecks keep the rounds, and the first and last check', () => {
	withTmpDir('stats-', dir => {
		assert.equal(readChecks(dir), null);
		recordCheck(dir, [problem('rate-format', 'report: Finding 1 rate'), problem('rate-format', 'report: Finding 2 rate'), problem('two-actions', 'ledger: S01 step 1')]);
		recordCheck(dir, [problem('two-actions', 'ledger: S01 step 1')]);
		recordCheck(dir, []);
		const checks = readChecks(dir);
		assert.equal(checks.rounds, 3);
		assert.equal(checks.first.problems, 3);
		assert.equal(checks.last, 0);
		assert.deepEqual(checks.first.rules, { 'rate-format': 2, 'two-actions': 1 });
		// A torn last line from an interrupted run is skipped, not fatal.
		writeFileSync(join(dir, CHECKS_FILE), `${readFileSync(join(dir, CHECKS_FILE), 'utf8')}{"at":`);
		assert.equal(readChecks(dir).rounds, 3);
	});
	assert.equal(summarizeChecks(''), null);
});

test('buildStats counts findings and verdicts from the parsed report', () => {
	const stats = buildStats({
		where: 'ci', date: '2026-09-28T12:00:00.000Z', version: '1.1', costUsd: 3.756,
		parsed: { chips: ['fix/x', 'abc1234567'], findings: [{ verified: 'confirmed' }, { verified: 'disputed' }, { verified: null }] },
		checks: null,
	});
	assert.equal(stats.branch, 'fix/x');
	assert.equal(stats.findings, 3);
	assert.deepEqual(stats.verdicts, { confirmed: 1, disputed: 1 });
	assert.equal(stats.costUsd, 3.76);
	assert.equal(stats.timeLimit, null);
	const limited = buildStats({ where: 'ci', parsed: null, timeLimit: { minutes: 20, reached: true, stopped: false } });
	assert.deepEqual(limited.timeLimit, { minutes: 20, reached: true, stopped: false });
});

test('statsFromLog reads the line run.mjs prints, from a timestamped job log', () => {
	const record = { where: 'ci', version: '1.1', turns: 90 };
	const log = `2026-09-28T12:00:00.0000000Z [exploratory] result: {}\n2026-09-28T12:30:00.0000000Z [exploratory] stats: ${JSON.stringify(record)}\n`;
	assert.deepEqual(statsFromLog(log), record);
	assert.equal(statsFromLog('no stats here'), null);
});

test('summarizeByVersion counts a rule once per run it fired in', () => {
	const run = (version, rules, rounds) => ({ version, turns: 80, costUsd: 3, checks: { rounds, first: { problems: Object.values(rules).reduce((a, b) => a + b, 0), rules }, last: 0 } });
	const [v11, v12] = summarizeByVersion([
		run('1.1', { a: 3 }, 2),
		run('1.1', { a: 1, b: 1 }, 2),
		run('1.2', { b: 2 }, 4),
		{ version: '1.2', turns: 90, costUsd: 4, checks: null },
	]);
	assert.equal(v11.version, '1.1');
	assert.deepEqual(v11.topRules, [{ rule: 'a', runs: 2 }, { rule: 'b', runs: 1 }]);
	assert.equal(v11.medianRounds, 2);
	assert.equal(v12.runs, 2);
	assert.equal(v12.checked, 1);
	assert.equal(v12.medianRounds, 4);
});

test('lint-json counts the explorer\'s checks, renders do not, and the pipeline\'s render writes stats.json', () => {
	withLogsRun(({ dir, report, render }) => {
		const lint = () => spawnSync(process.execPath, [LINT_JSON, report], { encoding: 'utf8' });
		lint();
		lint();
		assert.equal(readChecks(dir).rounds, 2);
		render(report);
		render(report, '--base', 'https://example.test/run', '--out', join(dir, 'published.html'));
		assert.equal(readChecks(dir).rounds, 2, 'the pipeline\'s and publish\'s renders are not the explorer\'s');
		const stats = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'));
		assert.equal(stats.where, 'local');
		assert.equal(stats.turns, 142);
		assert.equal(stats.durationMs, 1500000);
		assert.equal(stats.checks.rounds, 2);
		assert.match(stats.version, /^\d+\.\d+$/);
		assert.deepEqual(stats.severity, { major: 1, moderate: 1, minor: 0 });
		assert.equal(stats.notRun, 3);
		assert.deepEqual(stats.notRunReasons, [
			'Time; Python and DuckDB cover both null-vs-omitted serializations the diff mentions',
			'Could not make value fetches slow: the slow-hash trick only slows profiling',
			'Desktop build only',
		]);
		// The checks tune the skill, so they stay in stats.json and off the page.
		assert.doesNotMatch(readFileSync(join(dir, 'index.html'), 'utf8'), /Format checks|Raw stats/);
	}, [{ label: 'explore', model: 'claude-opus-5-5', costUsd: null, turns: 142, durationMs: 1500000 }]);
});

test('render.mjs records an isolation pass in the Agents table and stats.json', () => {
	withLogsRun(({ dir, report, render }) => {
		render(report);
		const stats = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'));
		assert.deepEqual(stats.isolate, { durationMs: 300000, turns: 30 });
		assert.equal(stats.durationMs, 960000);
		assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<div class="agents-row"><span>Isolate<\/span>/);
	}, [
		{ label: 'explore', model: 'claude-opus-5-5', costUsd: null, turns: 70, durationMs: 600000 },
		{ label: 'verify', model: 'claude-sonnet-5-5', costUsd: null, turns: 10, durationMs: 60000 },
		{ label: 'isolate', model: 'claude-sonnet-5-5', costUsd: null, turns: 30, durationMs: 300000 },
	]);
});

test('render.mjs gives the stats a cost when every pass has one, and keeps the stats CI recorded', () => {
	withLogsRun(({ dir, report, render }) => {
		render(report);
		assert.equal(JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')).costUsd, 4.12);
	}, [
		{ label: 'explore', model: 'opus', costUsd: 3.7, turns: 142, durationMs: 1500000 },
		{ label: 'verify', model: 'sonnet', costUsd: 0.4231, turns: 24, durationMs: 180000 },
	]);
	withLogsRun(({ dir, report, render }) => {
		writeFileSync(join(dir, 'cost.json'), '{}');
		writeFileSync(join(dir, 'stats.json'), '{"where":"ci"}\n');
		render(report);
		assert.equal(readFileSync(join(dir, 'stats.json'), 'utf8'), '{"where":"ci"}\n');
	}, [{ label: 'explore', model: 'opus', costUsd: null, turns: 10, durationMs: 60000 }]);
});

test('buildStats clips a long Not run reason', () => {
	const parsed = { coverage: { notExercised: [{ reason: 'x'.repeat(150) }] } };
	const { notRun, notRunReasons } = buildStats({ parsed });
	assert.equal(notRun, 1);
	assert.equal(notRunReasons[0], `${'x'.repeat(97)}...`);
});

test('the stats command tables local runs and sums them up by version', () => {
	withTmpDir('stats-', root => {
		for (const [name, version, rounds] of [['20260927T100000', '1.1', 2], ['20260928T100000', '1.2', 3]]) {
			mkdirSync(join(root, name));
			writeFileSync(join(root, name, 'stats.json'), JSON.stringify({
				where: 'local', date: `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T10:00:00.000Z`, branch: 'fix/x', version, model: 'claude-opus-5-5',
				turns: 90, findings: 1, verdicts: {}, checks: { rounds, first: { problems: 4, rules: { 'report: leave a blank line after </summary>': 1 } }, last: 0 },
			}));
		}
		mkdirSync(join(root, 'older-run-without-stats'));
		const out = execFileSync('node', [SCRIPT, '--no-ci', '--local-dir', root], { encoding: 'utf8' });
		assert.match(out, /^date\s+where\s+branch/m);
		assert.match(out, /2026-09-28\s+local\s+fix\/x\s+1\.2/);
		assert.match(out, /version 1\.1: 1 runs .* median rounds 2/);
		assert.match(out, /version 1\.2: 1 runs .* median rounds 3/);
		assert.match(out, /1x {2}report: leave a blank line after <\/summary>/);
		assert.ok(existsSync(root));
	});
});

test('the stats command rejects a --limit that is not a positive whole number', () => {
	for (const limit of ['abc', '0', '2.5']) {
		const r = spawnSync(process.execPath, [SCRIPT, '--no-local', '--limit', limit], { encoding: 'utf8' });
		assert.equal(r.status, 2, limit);
		assert.match(r.stderr, /--limit must be a positive whole number/);
	}
});

test('buildStats records main replay minutes only with a main build', () => {
	assert.equal(buildStats({ where: 'local', parsed: null, mainReplayMs: 150_000 }).mainReplayMinutes, 2.5);
	assert.equal(buildStats({ where: 'local', parsed: null }).mainReplayMinutes, null);
});
