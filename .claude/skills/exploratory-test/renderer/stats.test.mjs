/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStats, CHECKS_FILE, readChecks, recordCheck, ruleKey, statsFromLog, summarizeByVersion, summarizeChecks } from './stats.mjs';

const RENDER = fileURLToPath(new URL('./render.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./stats.mjs', import.meta.url));
const LOGS_DIR = fileURLToPath(new URL('./fixtures/logs-run/', import.meta.url));

function tempDir() {
	return mkdtempSync(join(tmpdir(), 'stats-'));
}

test('ruleKey gives one key per rule, whatever run-specific details a message carries', () => {
	assert.equal(
		ruleKey('ledger: S17 step 2 VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own'),
		ruleKey('ledger: S03 step 11 VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own'),
	);
	assert.equal(
		ruleKey('report: finding 2 Severity must be major, moderate or minor, got "High"'),
		ruleKey('report: finding 5 Severity must be major, moderate or minor, got "blocker"'),
	);
	assert.equal(
		ruleKey('report: Finding 1 names test file src/vs/a/test/a.vitest.ts, which is not in the repository; fix the path, mark it (new file), or drop it'),
		ruleKey('report: Finding 3 names test file extensions/b/src/test/b.test.ts, which is not in the repository; fix the path, mark it (new file), or drop it'),
	);
	// Lists of places, however long, and file names that start with a scenario ID.
	assert.equal(
		ruleKey('data.csv is named by Finding 1, Finding 2, S03, S04 but not saved; save it to files/'),
		ruleKey('app.py is named by Finding 2, S01 but not saved; save it to files/'),
	);
	assert.equal(
		ruleKey('ledger: S02-02.png is Evidence for S02 step 2 and S03 step 2 and S04 step 1; take a screenshot for each check'),
		ruleKey('ledger: a.png is Evidence for S20 step 2 and S24 step 2; take a screenshot for each check'),
	);
	assert.notEqual(ruleKey('report: leave a blank line after </summary>'), ruleKey('report: leave a blank line before </details>'));
});

test('recordCheck and summarizeChecks keep the rounds, and the first and last check', () => {
	const dir = tempDir();
	try {
		assert.equal(readChecks(dir), null);
		recordCheck(dir, ['report: finding 1 Reproduction must be N/M, got "3 of 3"', 'report: finding 2 Reproduction must be N/M, got "always"', 'report: leave a blank line after </summary>']);
		recordCheck(dir, ['report: leave a blank line after </summary>']);
		recordCheck(dir, []);
		const checks = readChecks(dir);
		assert.equal(checks.rounds, 3);
		assert.equal(checks.first.problems, 3);
		assert.equal(checks.last, 0);
		assert.deepEqual(Object.values(checks.first.rules).sort(), [1, 2]);
		// A torn last line from an interrupted run is skipped, not fatal.
		writeFileSync(join(dir, CHECKS_FILE), `${readFileSync(join(dir, CHECKS_FILE), 'utf8')}{"at":`);
		assert.equal(readChecks(dir).rounds, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

test('render.mjs counts the explorer\'s checks, not the harness\'s renders, and the last render writes stats.json', () => {
	const dir = tempDir();
	try {
		cpSync(LOGS_DIR, dir, { recursive: true });
		const report = join(dir, 'report.md');
		const render = args => spawnSync(process.execPath, [RENDER, report, ...args], { encoding: 'utf8' });
		render([]);
		render(['--check']);
		assert.equal(readChecks(dir).rounds, 2);
		render(['--model', 'claude-opus-5-5', '--duration-ms', '1500000', '--turns', '142']);
		render(['--base', 'https://example.test/run', '--out', join(dir, 'published.html')]);
		assert.equal(readChecks(dir).rounds, 2, 'the Run tile and publish renders are not the explorer\'s');
		const stats = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'));
		assert.equal(stats.where, 'local');
		assert.equal(stats.turns, 142);
		assert.equal(stats.durationMs, 1500000);
		assert.equal(stats.checks.rounds, 2);
		assert.match(stats.version, /^\d+\.\d+$/);
		// The page is written after stats.json, so Run details links it.
		assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /2 rounds &middot; \d+ problems? on the first check &middot; <a href="stats.json">raw stats<\/a>/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the stats command tables local runs and sums them up by version', () => {
	const root = tempDir();
	try {
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
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
