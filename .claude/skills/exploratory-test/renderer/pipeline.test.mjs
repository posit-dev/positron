/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishRun, ISOLATE_MINUTES, isolateTimeUpMessage, renderFlags, reviseMessage } from './pipeline.mjs';

const REPORT = [
	'# Exploratory test: something',
	'',
	'**Result:** Two things broke.',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Reproduction |',
	'|---|---------|----------|--------|--------------|',
	'| 1 | first claim | major | blocks completion | 3/3 |',
	'| 2 | second claim | minor | cosmetic | 2/2 |',
	'',
	'### Finding 1: first claim',
	'',
	'**Observed:** It broke.',
	'',
	'**Expected:** It works.',
	'',
	'### Finding 2: second claim',
	'',
	'**Observed:** It also broke.',
	'',
	'**Expected:** It works.',
	'',
].join('\n');

const SHAS = { repo: '/repo', base: 'aaaa1111', head: 'bbbb2222', baseName: 'main' };

/**
 * Runs the pipeline on a fresh run directory with a fake agent per purpose:
 * `agents[purpose](step, dir)` returns the reply text or throws. Resolves to
 * the steps the agents were given, in order, the stops, the log and the report.
 */
async function runWith(report, agents, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
	writeFileSync(join(dir, 'report.md'), report);
	const run = { dir, steps: [], stops: 0, logs: [] };
	try {
		run.passes = await finishRun(dir, {
			...SHAS,
			runAgent: async step => {
				run.steps.push(step);
				const agent = agents[step.purpose];
				assert.ok(agent, `no agent for ${step.purpose}`);
				return { text: await agent(step, dir), durationMs: 1000, turns: 2, costUsd: 0.5, sessionId: `${step.purpose}-session` };
			},
			stop: () => run.stops++,
			log: line => run.logs.push(line),
			...options,
		});
		run.report = readFileSync(join(dir, 'report.md'), 'utf8');
		run.purposes = run.steps.map(s => s.purpose);
		// Listed before the directory is removed below.
		const files = readdirSync(dir);
		run.exists = name => files.includes(name);
		run.changeBase = files.includes('change-base.json') ? JSON.parse(readFileSync(join(dir, 'change-base.json'), 'utf8')) : null;
		return run;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const EDIT = () => 'RESULT: Two things broke.';
const fail = message => () => { throw new Error(message); };

test('a report with no findings and no Result needs no agent', async () => {
	const run = await runWith('# Exploratory test: x\n\n## Findings\n\nNo findings.\n', {});
	assert.deepEqual(run.steps, []);
	assert.equal(run.stops, 1);
});

test('a clean verify goes on to the editor, and each agent is recorded', async () => {
	const run = await runWith(REPORT, { verify: () => 'notes\nVERDICTS: 1=CONFIRMED; 2=CONFIRMED\n\n- 1: matches.', edit: EDIT });
	assert.deepEqual(run.purposes, ['verify', 'edit']);
	const [verify, edit] = run.steps;
	assert.deepEqual({ ...verify, prompt: undefined }, { model: 'sonnet', role: 'verify', purpose: 'verify', tools: ['Bash', 'Read', 'Glob', 'Grep'], cwd: '/repo', prompt: undefined });
	assert.match(verify.prompt, /aaaa1111/);
	assert.deepEqual({ ...edit, prompt: undefined }, { model: 'sonnet', role: 'edit', purpose: 'edit', tools: [], cwd: run.dir, prompt: undefined });
	assert.match(run.report, /\| 2 \| second claim .* \| confirmed \|/);
	assert.equal(run.changeBase.name, 'main', 'the base branch reaches the change mark');
	assert.equal(run.stops, 1);
	assert.deepEqual(run.passes, [
		{ role: 'verify', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
		{ role: 'edit', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
	]);
});

test('an UNRESOLVED verdict is isolated, then the verifier revises in the same session', async () => {
	const run = await runWith(REPORT, {
		verify: () => 'VERDICTS: 1=CONFIRMED; 2=UNRESOLVED\n\n- 2: needs the same steps with the setting off.',
		isolate: (step, dir) => {
			assert.doesNotMatch(readFileSync(join(dir, 'report.md'), 'utf8'), /Verified/, 'nothing is applied before the revision');
			writeFileSync(join(dir, 'isolation.md'), '## Finding 2\n\nThe setting decides it.');
			return 'done';
		},
		revise: () => 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED',
		edit: EDIT,
	});
	assert.deepEqual(run.purposes, ['verify', 'isolate', 'revise', 'edit']);
	const [, isolate, revise] = run.steps;
	assert.equal(isolate.timeLimitMinutes, ISOLATE_MINUTES);
	assert.equal(isolate.timeUpMessage, isolateTimeUpMessage(run.dir));
	assert.match(isolate.prompt, /^You are narrowing down the cause/);
	assert.match(isolate.prompt, /Checkout: `\/repo`\nBase: `aaaa1111`\nHead: `bbbb2222`\nFindings: Finding 2\n/);
	assert.match(isolate.prompt, /needs the same steps with the setting off/);
	assert.deepEqual({ resume: revise.resume, prompt: revise.prompt }, { resume: 'verify-session', prompt: reviseMessage(run.dir) });
	assert.equal(run.stops, 2, 'the isolator\'s instances are stopped too');
	assert.match(run.report, /\| 2 \| second claim .* \| confirmed \|/);
	assert.deepEqual(renderFlags({ model: 'opus', durationMs: 60000, turns: 40 }, run.passes), [
		'--model', 'opus', '--duration-ms', '60000', '--turns', '40',
		'--verify-model', 'sonnet', '--verify-duration-ms', '2000', '--verify-turns', '4', '--verify-cost-usd', '1',
		'--isolate-model', 'sonnet', '--isolate-duration-ms', '1000', '--isolate-turns', '2', '--isolate-cost-usd', '0.5',
	]);
});

test('an isolator that writes nothing, or a revision that fails, keeps the first verdicts', async () => {
	const unresolved = () => 'VERDICTS: 1=CONFIRMED; 2=UNRESOLVED';
	const silent = await runWith(REPORT, { verify: unresolved, isolate: () => '', edit: EDIT });
	assert.deepEqual(silent.purposes, ['verify', 'isolate', 'edit']);
	assert.match(silent.report, /\| 2 \| second claim .* \| unresolved \|/);
	assert.ok(silent.logs.includes('the isolator wrote no isolation.md; applying the verifier\'s first reply'));
	const crashed = await runWith(REPORT, {
		verify: unresolved,
		isolate: (step, dir) => { writeFileSync(join(dir, 'isolation.md'), 'x'); return ''; },
		revise: fail('the session crashed'),
		edit: EDIT,
	});
	assert.deepEqual(crashed.purposes, ['verify', 'isolate', 'revise', 'edit']);
	assert.match(crashed.report, /\| 2 \| second claim .* \| unresolved \|/);
	assert.ok(crashed.logs.includes('the verify agent failed: the session crashed'));
});

test('verdicts keyed to the wrong numbers get one retry, then mark the findings unreviewed', async () => {
	const fixed = await runWith(REPORT, { verify: () => 'VERDICTS: 1=CONFIRMED; 3=CONFIRMED', renumber: () => 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED', edit: EDIT });
	const retry = fixed.steps[1];
	assert.equal(retry.resume, 'verify-session');
	assert.match(retry.prompt, /^the VERDICTS line gives findings 1, 3, but the report's findings are 1, 2.*Reply again in full, in the same format\.$/);
	assert.match(fixed.report, /\| 2 \| second claim .* \| confirmed \|/);
	const wrongAgain = await runWith(REPORT, { verify: () => 'VERDICTS: 1=CONFIRMED; 3=CONFIRMED', renumber: () => 'VERDICTS: 2=CONFIRMED; 3=CONFIRMED', edit: EDIT });
	assert.match(wrongAgain.report, /## Verification\n\n_Verification did not complete: the VERDICTS line gives findings 2, 3.*The findings above are unreviewed\._/);
});

test('a verifier that fails leaves the findings marked unreviewed, with its error', async () => {
	const empty = await runWith(REPORT, { verify: () => '', edit: EDIT });
	assert.match(empty.report, /## Verification\n\n_Verification did not complete\. The findings above are unreviewed\._/);
	const crashed = await runWith(REPORT, { verify: fail('maxTurns reached'), edit: EDIT });
	assert.match(crashed.report, /_Verification did not complete: maxTurns reached\. The findings above are unreviewed\._/);
	assert.deepEqual(crashed.passes.map(p => p.role), ['edit'], 'a failed agent has no usage to record');
});

test('an edit the guard rejects gets one retry, applied as the last', async () => {
	const run = await runWith(REPORT, {
		verify: () => 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED',
		edit: () => 'RESULT: Two things broke.\n\n=== Finding 1\nTITLE: first | claim',
		'edit-retry': () => '=== Finding 1\nTITLE: first | claim again',
	});
	assert.deepEqual(run.purposes, ['verify', 'edit', 'edit-retry']);
	assert.equal(run.logs.filter(line => line.startsWith('kept the original')).length, 2);
	assert.ok(run.logs.includes('kept the original of Finding 1\'s title: the rewrite has a |, ; or code'));
});

test('with verify off it goes straight to the editor; with it on it needs the diff range', async () => {
	const off = await runWith(REPORT, { edit: EDIT }, { verify: false, repo: undefined });
	assert.deepEqual(off.purposes, ['edit']);
	assert.ok(!off.exists('verify-prompt.md'));
	await assert.rejects(runWith(REPORT, {}, { repo: undefined }), /verifying needs --repo, --base and --head/);
});

test('renderFlags needs the explorer\'s time', () => {
	assert.deepEqual(renderFlags({ model: 'opus', durationMs: null, turns: 3 }, []), []);
	assert.deepEqual(renderFlags({ model: 'opus', durationMs: 60000, turns: null }, []), ['--model', 'opus', '--duration-ms', '60000']);
});

const SCRIPT = fileURLToPath(new URL('./pipeline.mjs', import.meta.url));

test('the CLI names what it needs', () => {
	const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
	try {
		assert.match(spawnSync('node', [SCRIPT, 'next', dir], { encoding: 'utf8' }).stderr, /^usage: node pipeline\.mjs run/);
		writeFileSync(join(dir, 'report.md'), REPORT);
		const missing = spawnSync('node', [SCRIPT, 'run', dir], { encoding: 'utf8' });
		assert.equal(missing.status, 2);
		assert.match(missing.stderr, /verifying needs --repo, --base and --head/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
