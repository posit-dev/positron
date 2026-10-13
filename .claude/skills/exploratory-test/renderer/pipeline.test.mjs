/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutProblems, completeRun, costPasses, environmentLines, explore, EXPLORE_TIME_UP, explorePrompt, finishRun, ISOLATE_MINUTES, isolateTimeUpMessage, prepareInstance, recordBranchCheck, REFORMAT_MESSAGE, reviseMessage, sessionName } from './pipeline.mjs';
import { parseSystemLine } from './shared/ledger.mjs';
import { reportFromJson } from './page/report-json.mjs';
import { withTmpDir } from './shared/tmp-dirs.mjs';

const REPORT = {
	header: { title: 'Exploratory test: something', result: 'Two things broke.' },
	findings: [
		{ n: 1, title: 'first claim', feature: 'Console', severity: 'major', reproduced: { n: 3, m: 3 }, observed: 'It broke.', expected: 'It works.', steps: [], tests: {} },
		{ n: 2, title: 'second claim', feature: 'Plots', severity: 'minor', reproduced: { n: 2, m: 2 }, observed: 'It also broke.', expected: 'It works.', steps: [], tests: {} },
	],
};

const SHAS = { repo: '/repo', base: 'aaaa1111', head: 'bbbb2222', baseName: 'main' };

/**
 * Runs the pipeline on a fresh run directory with a fake agent per purpose:
 * `agents[purpose](step, dir)` returns the reply text or throws. Resolves to
 * the steps the agents were given, in order, the stops, the log and the report.
 */
function runWith(report, agents, options = {}) {
	return withTmpDir('pipeline-', async dir => {
		writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
		for (const [name, text] of Object.entries(options.files ?? {})) {
			writeFileSync(join(dir, name), text);
		}
		delete options.files;
		const run = { dir, steps: [], stops: 0, logs: [] };
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
		run.report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
		run.purposes = run.steps.map(s => s.purpose);
		// Listed before the directory is removed.
		const files = readdirSync(dir);
		run.exists = name => files.includes(name);
		run.changeBase = files.includes('change-base.json') ? JSON.parse(readFileSync(join(dir, 'change-base.json'), 'utf8')) : null;
		return run;
	});
}

const EDIT = () => 'RESULT: Two things broke.';
/** A verifier reply: a json block with `findings` as [n, verdict, extra fields], then notes. */
const verdicts = (findings, notes = '') => `\`\`\`json\n${JSON.stringify({ findings: findings.map(([n, verdict, more = {}]) => ({ n, verdict, ...more })) })}\n\`\`\`${notes ? `\n\n${notes}` : ''}`;
const fail = message => () => { throw new Error(message); };

test('a report with no findings and no Result needs no agent', async () => {
	const run = await runWith({ header: { title: 'Exploratory test: x' }, findings: [] }, {});
	assert.deepEqual(run.steps, []);
	assert.equal(run.stops, 1);
});

test('a clean verify goes on to the editor, and each agent is recorded', async () => {
	const run = await runWith(REPORT, { verify: () => `notes\n${verdicts([[1, 'confirmed'], [2, 'confirmed']], '- 1: matches.')}`, edit: EDIT });
	assert.deepEqual(run.purposes, ['verify', 'edit']);
	const [verify, edit] = run.steps;
	assert.deepEqual({ ...verify, prompt: undefined }, { model: 'sonnet', role: 'verify', purpose: 'verify', tools: ['Bash', 'Read', 'Glob', 'Grep'], cwd: '/repo', prompt: undefined });
	assert.match(verify.prompt, /aaaa1111/);
	assert.deepEqual({ ...edit, prompt: undefined }, { model: 'sonnet', role: 'edit', purpose: 'edit', tools: [], cwd: run.dir, prompt: undefined });
	assert.equal(run.report.findings[1].verified, 'confirmed');
	assert.equal(run.changeBase.name, 'main', 'the base branch reaches the change mark');
	assert.equal(run.stops, 1);
	assert.deepEqual(run.passes, [
		{ role: 'verify', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
		{ role: 'edit', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
	]);
});

test('an UNRESOLVED verdict is isolated, then the verifier revises in the same session', async () => {
	const run = await runWith(REPORT, {
		verify: () => verdicts([[1, 'confirmed'], [2, 'unresolved']], '- 2: needs the same steps with the setting off.'),
		isolate: (step, dir) => {
			assert.equal(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).verification, undefined, 'nothing is applied before the revision');
			writeFileSync(join(dir, 'isolation.md'), '## Finding 2\n\nThe setting decides it.');
			return 'done';
		},
		revise: () => verdicts([[1, 'confirmed'], [2, 'confirmed']]),
		edit: EDIT,
	});
	assert.deepEqual(run.purposes, ['verify', 'isolate', 'revise', 'edit']);
	const [, isolate, revise] = run.steps;
	assert.equal(isolate.timeLimitMinutes, ISOLATE_MINUTES);
	assert.equal(isolate.timeUpMessage, isolateTimeUpMessage(run.dir));
	assert.match(isolate.prompt, /^You are narrowing down the cause/);
	assert.match(isolate.prompt, /Checkout: `\/repo`\nBase: `aaaa1111`\nHead: `bbbb2222`\nReport: `[^`]*\/report\.json`\nPlaywright session: `et-[^`]+-iso`\nFindings: Finding 2\n/);
	assert.match(isolate.prompt, /needs the same steps with the setting off/);
	assert.deepEqual({ resume: revise.resume, prompt: revise.prompt }, { resume: 'verify-session', prompt: reviseMessage(run.dir) });
	assert.equal(run.stops, 2, 'the isolator\'s instances are stopped too');
	assert.equal(run.report.findings[1].verified, 'confirmed');
	assert.deepEqual(costPasses({ model: 'opus', durationMs: 60000, turns: 40, costUsd: null }, run.passes), [
		{ label: 'explore', model: 'opus', costUsd: null, turns: 40, durationMs: 60000 },
		{ label: 'verify', model: 'sonnet', costUsd: 1, turns: 4, durationMs: 2000 },
		{ label: 'isolate', model: 'sonnet', costUsd: 0.5, turns: 2, durationMs: 1000 },
		{ label: 'edit', model: 'sonnet', costUsd: 0.5, turns: 2, durationMs: 1000 },
	]);
});

test('an isolator that writes nothing, or a revision that fails, keeps the first verdicts', async () => {
	const unresolved = () => verdicts([[1, 'confirmed'], [2, 'unresolved']]);
	const silent = await runWith(REPORT, { verify: unresolved, isolate: () => '', edit: EDIT });
	assert.deepEqual(silent.purposes, ['verify', 'isolate', 'edit']);
	assert.equal(silent.report.findings[1].verified, 'unresolved');
	assert.ok(silent.logs.includes('the isolator wrote no isolation.md; applying the verifier\'s first reply'));
	const crashed = await runWith(REPORT, {
		verify: unresolved,
		isolate: (step, dir) => { writeFileSync(join(dir, 'isolation.md'), 'x'); return ''; },
		revise: fail('the session crashed'),
		edit: EDIT,
	});
	assert.deepEqual(crashed.purposes, ['verify', 'isolate', 'revise', 'edit']);
	assert.equal(crashed.report.findings[1].verified, 'unresolved');
	assert.ok(crashed.logs.includes('the verify agent failed: the session crashed'));
});

test('verdicts keyed to the wrong numbers get one retry, then mark the findings unreviewed', async () => {
	const fixed = await runWith(REPORT, { verify: () => verdicts([[1, 'confirmed'], [3, 'confirmed']]), recheck: () => verdicts([[1, 'confirmed'], [2, 'confirmed']]), edit: EDIT });
	const retry = fixed.steps[1];
	assert.equal(retry.resume, 'verify-session');
	assert.match(retry.prompt, /^the verdicts give findings 1, 3, but the report's findings are 1, 2.*Reply again in full, in the same format\.$/);
	assert.equal(fixed.report.findings[1].verified, 'confirmed');
	const wrongAgain = await runWith(REPORT, { verify: () => verdicts([[1, 'confirmed'], [3, 'confirmed']]), recheck: () => verdicts([[2, 'confirmed'], [3, 'confirmed']]), edit: EDIT });
	assert.equal(wrongAgain.report.verification.failed, true);
	assert.match(wrongAgain.report.verification.text, /^_Verification did not complete: the verdicts give findings 2, 3.*The findings above are unreviewed\._/);
});

test('a last message with no json block gets one request for the reply again, in the same session', async () => {
	const late = 'The background search finished; nothing changes.';
	const fixed = await runWith(REPORT, { verify: () => late, reformat: () => verdicts([[1, 'confirmed'], [2, 'confirmed']]), edit: EDIT });
	assert.deepEqual(fixed.purposes, ['verify', 'reformat', 'edit']);
	assert.deepEqual({ resume: fixed.steps[1].resume, prompt: fixed.steps[1].prompt }, { resume: 'verify-session', prompt: REFORMAT_MESSAGE });
	assert.equal(fixed.report.findings[1].verified, 'confirmed');
	// Still none: the findings are marked unreviewed, as before.
	const still = await runWith(REPORT, { verify: () => late, reformat: () => late, edit: EDIT });
	assert.match(still.report.verification.text, /^_Verification did not complete: the reply has no ```json block\./);
});

test('a verifier that fails leaves the findings marked unreviewed, with its error', async () => {
	const empty = await runWith(REPORT, { verify: () => '', edit: EDIT });
	assert.match(empty.report.verification.text, /^_Verification did not complete\. The findings above are unreviewed\._/);
	const crashed = await runWith(REPORT, { verify: fail('maxTurns reached'), edit: EDIT });
	assert.match(crashed.report.verification.text, /^_Verification did not complete: maxTurns reached\. The findings above are unreviewed\._/);
	assert.deepEqual(crashed.passes.map(p => p.role), ['edit'], 'a failed agent has no usage to record');
});

test('an edit the guard rejects gets one retry, applied as the last', async () => {
	const run = await runWith(REPORT, {
		verify: () => verdicts([[1, 'confirmed'], [2, 'confirmed']]),
		edit: () => 'RESULT: Two things broke.\n\n=== Finding 1\nTITLE: first | claim',
		'edit-retry': () => '=== Finding 1\nTITLE: first | claim again',
	});
	assert.deepEqual(run.purposes, ['verify', 'edit', 'edit-retry']);
	assert.equal(run.logs.filter(line => line.startsWith('kept the original')).length, 2);
	assert.ok(run.logs.includes('kept the original of Finding 1\'s title: the rewrite has a | or ;'));
});

test('with verify off it goes straight to the editor; with it on it needs the diff range', async () => {
	const off = await runWith(REPORT, { edit: EDIT }, { verify: false, repo: undefined });
	assert.deepEqual(off.purposes, ['edit']);
	assert.ok(!off.exists('verify-prompt.md'));
	await assert.rejects(runWith(REPORT, {}, { repo: undefined }), /verifying needs --repo, --base and --head/);
});

test('the verdicts, the isolation\'s revision and the edits land in report.json, and the page shows them', async () => {
	const run = await runWith(REPORT, {
		verify: () => verdicts([[1, 'confirmed'], [2, 'unresolved']], '- 2: needs the same steps with the setting off.'),
		isolate: (step, dir) => {
			writeFileSync(join(dir, 'isolation.md'), '## Finding 2\n\nThe setting decides it.');
			return 'done';
		},
		revise: () => verdicts([[1, 'confirmed', { known: [15102], related: true }], [2, 'false positive', { intended: [999], feature: 'Plot settings', title: 'second claim, with the setting off' }]], '- 2: the setting decides it.'),
		edit: () => 'RESULT: Two things broke, one by design.\n\n=== Finding 1\nTITLE: first claim, reworded\nSUMMARY: It broke.\nWHERE: It works.',
	});
	assert.match(run.steps[1].prompt, /Report: `[^`]*\/report\.json`/);
	const page = reportFromJson(run.report);
	assert.deepEqual({
		leadHtml: page.leadHtml,
		verdicts: page.verification.verdicts,
		change: [...page.verification.change],
		findings: page.findings.map(f => ({ n: f.n, title: f.title, feature: f.feature, verified: f.verified, known: f.known, intended: f.intended, opening: f.text.opening })),
	}, {
		leadHtml: 'Two things broke, one by design.',
		verdicts: [{ n: 1, word: 'confirmed' }, { n: 2, word: 'disputed' }],
		change: [1],
		findings: [
			{ n: 1, title: 'first claim, reworded', feature: 'Console', verified: 'confirmed', known: [15102], intended: [], opening: { summary: 'It broke.', where: 'It works.' } },
			{ n: 2, title: 'second claim, with the setting off', feature: 'Plot settings', verified: 'disputed', known: [], intended: [999], opening: null },
		],
	});
});

test('costPasses sums each later role over its sessions, after the explorer', () => {
	assert.deepEqual(costPasses({ model: 'opus', durationMs: 60000, turns: 40, costUsd: 3 }, [
		{ role: 'verify', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
		{ role: 'edit', model: 'sonnet', durationMs: 500, turns: null, costUsd: null },
		{ role: 'verify', model: 'sonnet', durationMs: 1000, turns: 2, costUsd: 0.5 },
	]), [
		{ label: 'explore', model: 'opus', costUsd: 3, turns: 40, durationMs: 60000 },
		{ label: 'verify', model: 'sonnet', costUsd: 1, turns: 4, durationMs: 2000 },
		{ label: 'edit', model: 'sonnet', costUsd: null, turns: null, durationMs: 500 },
	]);
});

test('the explorer gets explorer.md, the brief and its run directory, and keeps its usage', () => withTmpDir('pipeline-', async dir => {
	const calls = [];
	const pass = await explore(dir, {
		brief: 'Test the Variables pane.\n', repo: '/repo', timeLimitPath: join(dir, 'time-limit'),
		runAgent: async step => { calls.push(step); return { text: 'Found one.', durationMs: 600000, turns: 70, costUsd: 3.1 }; },
	});
	const [step] = calls;
	assert.match(step.prompt, /^# Exploratory testing: the explorer/);
	assert.match(step.prompt, /# Brief\n\nTest the Variables pane\.\n/);
	assert.ok(step.prompt.includes(`Run directory: \`${dir}\``));
	assert.ok(step.prompt.includes(`Playwright session: \`${sessionName(dir)}\``));
	assert.deepEqual({ ...step, prompt: undefined }, { role: 'explore', purpose: 'explore', model: 'opus', prompt: undefined, tools: ['Bash', 'Read', 'Glob', 'Grep'], cwd: '/repo', timeLimitPath: join(dir, 'time-limit'), timeUpMessage: EXPLORE_TIME_UP });
	assert.deepEqual(pass, { role: 'explore', model: 'opus', durationMs: 600000, turns: 70, costUsd: 3.1 });
	assert.equal(readFileSync(join(dir, 'explore-reply.md'), 'utf8'), 'Found one.');
	assert.equal(await explore(dir, { brief: 'b', repo: '/repo', runAgent: async () => { throw new Error('no login'); } }), null);
}));

const SCRIPT = fileURLToPath(new URL('./pipeline.mjs', import.meta.url));

test('the CLI names what it needs', () => withTmpDir('pipeline-', dir => {
	assert.match(spawnSync('node', [SCRIPT, 'next', dir], { encoding: 'utf8' }).stderr, /^usage: node pipeline\.mjs run/);
	writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
	const missing = spawnSync('node', [SCRIPT, 'run', dir], { encoding: 'utf8' });
	assert.equal(missing.status, 2);
	assert.match(missing.stderr, /verifying needs --repo, --base and --head/);
	// A fresh run needs a brief that exists and a limit in whole minutes.
	assert.equal(spawnSync('node', [SCRIPT, 'run', '--brief', join(dir, 'missing.md')], { encoding: 'utf8' }).status, 2);
	assert.equal(spawnSync('node', [SCRIPT, 'run', '--brief', join(dir, 'report.json'), '--time-limit', '10m'], { encoding: 'utf8' }).status, 2);
}));

test('a stopped run stops the agent it started', () => withTmpDir('pipeline-stop-', async home => {
	const bin = join(home, 'bin');
	const pidFile = join(home, 'agent.pid');
	mkdirSync(bin);
	// A stand-in for claude that only records its pid and waits.
	writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 60\n`);
	chmodSync(join(bin, 'claude'), 0o755);
	writeFileSync(join(home, 'brief.md'), 'Test the Variables pane.\n');
	const run = spawn('node', [SCRIPT, 'run', '--brief', join(home, 'brief.md'), '--repo', home, '--base', 'a', '--head', 'b', '--time-limit', 'none', '--skip-checkout-check', '--no-launch'], {
		env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdio: 'ignore',
	});
	try {
		while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8').trim()) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		const agent = Number(readFileSync(pidFile, 'utf8'));
		const code = await new Promise(resolve => {
			run.on('exit', resolve);
			run.kill('SIGTERM');
		});
		assert.equal(code, 143);
		await new Promise(resolve => setTimeout(resolve, 200));
		assert.throws(() => process.kill(agent, 0));
	} finally {
		run.kill('SIGKILL');
	}
}));

test('sessionName is the run directory\'s id, so two runs never share one', () => {
	assert.equal(sessionName('/state/output/20261013T122204-EAzyXV'), 'et-EAzyXV');
	assert.notEqual(sessionName('/state/output/20261013T122204-EAzyXV'), sessionName('/state/output/20261013T122204-IJD6rF'));
});

test('a fresh run gives its agents its own Playwright session and log paths in their environment, and briefs no instance when the launch fails', () => withTmpDir('pipeline-session-', home => {
	const bin = join(home, 'bin');
	const seen = join(home, 'env.txt');
	mkdirSync(bin);
	// A stand-in for claude that records the session it was given and fails.
	writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat > /dev/null\necho "$PW_SESSION $PLAYWRIGHT_CLI_SESSION $RUN $DRIVE_POSITRON_LOG $DRIVE_POSITRON_SHOTS" > '${seen}'\nexit 1\n`);
	chmodSync(join(bin, 'claude'), 0o755);
	writeFileSync(join(home, 'brief.md'), 'Test the Variables pane.\n');
	const run = spawnSync('node', [SCRIPT, 'run', '--brief', join(home, 'brief.md'), '--repo', home, '--base', 'a', '--head', 'b', '--time-limit', 'none', '--skip-checkout-check'], {
		env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PW_SESSION: 'positron', PLAYWRIGHT_CLI_SESSION: 'positron' }, encoding: 'utf8',
	});
	const dir = /run directory: (\S+)/.exec(run.stdout)?.[1];
	assert.ok(dir, run.stderr);
	assert.equal(readFileSync(seen, 'utf8').trim(), `${sessionName(dir)} ${sessionName(dir)} ${dir} ${join(dir, 'actions.log')} ${join(dir, 'shots')}`);
	// The checkout has no drive-positron, so the launch fails and the explorer launches its own.
	assert.match(run.stderr, /saving the listeners failed: .*; the explorer launches its own/);
	assert.doesNotMatch(readFileSync(join(dir, 'explore-prompt.md'), 'utf8'), /The running app/);
}));

test('prepareInstance launches on the run\'s workspace and venv, lists the instance, and attaches the session', () => withTmpDir('pipeline-prepare-', dir => {
	const calls = [];
	const launched = '{"pid":42,"cdpPort":9333,"runDir":"/tmp/positron-dev-launch/x","logFile":"/tmp/positron-dev-launch/x/launch.log"}';
	const run = (file, args) => {
		calls.push([basename(file), ...args.map(a => a.replace(dir, '$RUN').replace(/.*\/scripts\//, ''))]);
		return /launch\.sh$/.test(args[0]) ? `starting\n${launched}\n` : '';
	};
	const instance = prepareInstance(dir, { repo: '/repo', session: 'et-abc', run });
	assert.deepEqual(calls, [
		['bash', 'listeners.sh', '--save', '$RUN/tmp/listeners-before.txt'],
		['bash', 'run-venv.sh', '$RUN/tmp/venv'],
		['bash', 'launch.sh', '--', '--folder-uri', `file://$RUN/workspace`, '--log', 'debug'],
		['playwright-cli', '-s=et-abc', 'attach', '--cdp=http://127.0.0.1:9333'],
	]);
	assert.deepEqual(instance, { pid: 42, cdpPort: 9333, runDir: '/tmp/positron-dev-launch/x', logFile: '/tmp/positron-dev-launch/x/launch.log', workspace: join(dir, 'workspace') });
	assert.equal(readlinkSync(join(dir, 'workspace', '.venv')), join(dir, 'tmp', 'venv'));
	assert.equal(readFileSync(join(dir, 'instances.jsonl'), 'utf8'), `${launched}\n`);
	assert.ok(existsSync(join(dir, 'shots')));
	const prompt = explorePrompt(dir, 'Test it.', [], instance);
	assert.match(prompt, /## The running app\n\nPositron is already launched, and the Playwright session `et-[^`]+` is attached to it on CDP port 9333\./);
	assert.doesNotMatch(explorePrompt(dir, 'Test it.'), /The running app/);
}));

test('prepareInstance reports the step that failed, and an instance launched before it stays listed to be stopped', () => withTmpDir('pipeline-prepare-', dir => {
	const run = (file, args) => {
		if (file.endsWith('playwright-cli')) {
			throw Object.assign(new Error('Command failed'), { stderr: 'connecting...\nconnect ECONNREFUSED 127.0.0.1:9333\n' });
		}
		return /launch\.sh$/.test(args[0]) ? '{"pid":42,"cdpPort":9333}\n' : '';
	};
	assert.deepEqual(prepareInstance(dir, { repo: '/repo', session: 'et-abc', run }), { error: 'attaching failed: connect ECONNREFUSED 127.0.0.1:9333' });
	assert.equal(readFileSync(join(dir, 'instances.jsonl'), 'utf8'), '{"pid":42,"cdpPort":9333}\n');
}));

test('checkoutProblems names a checkout off its head, a stale or missing build, and each missing binary, with its fix', () => {
	const git = ({ at = 'bbb', time = '100' } = {}) => args => ({ 'rev-parse HEAD': at, 'rev-parse bbb^{commit}': 'bbb', 'log -1 --format=%ct -- src': time })[args.join(' ')] ?? '';
	const binaries = path => path.endsWith('.exe') ? null : 1;
	const check = ({ head = 'bbb', at, time, mtimeMs = binaries, builtMs = 200_000 } = {}) => checkoutProblems({ head, git: git({ at, time }), mtimeMs, builtMs });
	assert.deepEqual(check(), []);
	assert.deepEqual(check({ time: '300', mtimeMs: path => path.includes('pet') ? null : binaries(path) }), [
		'the build is older than the last change to src/; rebuild with npm run build-start, then npm run build-check',
		'the Python locator (pet) is missing (extensions/positron-python/python-env-tools/pet); install it: cd extensions/positron-python && npm run install-pet',
	]);
	assert.deepEqual(check({ at: 'aaa', builtMs: null }), [
		'the checkout is at aaa, not --head bbb; check out the head, then build',
		'there is no build (out/); build it with npm run build-start, then npm run build-check',
	]);
	assert.deepEqual(check({ head: 'ccc' }), ['--head ccc is not a commit in it; fetch it, check it out, then build']);
	assert.deepEqual(check({ at: '' }), ['it is not a git checkout']);
	// A Windows checkout's binaries end in .exe.
	assert.deepEqual(check({ mtimeMs: path => path.endsWith('.exe') ? 1 : null }), []);
});

test('the Environment lines read as lint and the issue button read them, with 0 as a build number', () => {
	const lines = environmentLines({ product: { positronVersion: '2026.11.0', positronBuildNumber: 0 }, codeVersion: '1.134.0', commit: '9c6fd69592', os: 'macOS 27.0 (Darwin arm64)', ark: '0.1.252', kallichore: '0.1.71' });
	assert.deepEqual(lines, [
		'- Positron 2026.11.0 build 0, dev build of 9c6fd69592 (Code - OSS 1.134.0), on macOS 27.0 (Darwin arm64).',
		'- Kernels: Ark 0.1.252, Kallichore 0.1.71.',
	]);
	assert.deepEqual(parseSystemLine(lines[0]), { positron: '2026.11.0 build 0 (`9c6fd69592`)', os: 'macOS 27.0 (Darwin arm64)' });
	// What could not be read says so, and a checkout with no kernels has no Kernels line.
	assert.deepEqual(environmentLines({}), ['- Positron not recorded build not recorded, dev build of not recorded (Code - OSS not recorded), on not recorded.']);
	assert.match(explorePrompt('/run', 'Test it.', lines), /## Environment\n\nRead from the checkout[^\n]*\n\n- Positron 2026\.11\.0 build 0,[^\n]*\n- Kernels: Ark 0\.1\.252, Kallichore 0\.1\.71\.\n/);
});

test('recordBranchCheck replaces the Branch verification a report has, and skips a run with no report', () => withTmpDir('branch-', dir => {
	recordBranchCheck(dir, 'checked');
	assert.ok(!existsSync(join(dir, 'report.json')));
	writeFileSync(join(dir, 'report.json'), JSON.stringify({ header: { details: [{ title: 'State manipulation', body: 'a' }, { title: 'Branch verification', body: 'the explorer grepped' }] }, findings: [] }));
	recordBranchCheck(dir, 'checked');
	assert.deepEqual(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).header.details, [{ title: 'State manipulation', body: 'a' }, { title: 'Branch verification', body: 'checked' }]);
}));

test('completeRun adds the header, the branch check and every pass\'s cost, or returns null with no report', () => withTmpDir('complete-', async dir => {
	const options = {
		...SHAS,
		verify: false,
		// The model that answered, when the runner knows it, over the one asked for.
		runAgent: async () => ({ text: EDIT(), model: 'claude-sonnet-5', durationMs: 1000, turns: 2, costUsd: 0.5 }),
		stop: () => { },
		branchCheck: 'Checked by CI.',
		header: { pr: { repo: 'posit-dev/positron', number: 7 } },
	};
	const explored = { model: 'claude-opus-5-5', costUsd: 3, turns: 40, maxTurns: 200, durationMs: 60000 };
	assert.equal(await completeRun(dir, explored, options), null);
	writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
	const json = await completeRun(dir, explored, options);
	assert.deepEqual(json, JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')));
	assert.deepEqual(json.header.pr, { repo: 'posit-dev/positron', number: 7 });
	assert.deepEqual(json.header.details.at(-1), { title: 'Branch verification', body: 'Checked by CI.' });
	assert.deepEqual(json.cost.passes, [
		{ label: 'explore', model: 'claude-opus-5-5', costUsd: 3, turns: 40, maxTurns: 200, durationMs: 60000 },
		{ label: 'edit', model: 'claude-sonnet-5', costUsd: 0.5, turns: 2, durationMs: 1000 },
	]);
}));

test('a verifier that does not show it checked the action log and the screenshots is asked once, and the report says when it still has not', async () => {
	const files = {
		'ledger.md': ['## S01 - first breaks', 'Status: fail - Finding 1', 'Steps:', '1. VERIFY it loads -> FAIL - Finding 1', '   Evidence: shots/S01-01.png, actions.log:2', '',
			'## S02 - second breaks', 'Status: fail - Finding 2', 'Steps:', '1. VERIFY it saves -> FAIL - Finding 2', '   Evidence: shots/S02-01.png, actions.log:4', ''].join('\n'),
		'actions.log': ['a', 'b', 'c', 'd', 'e'].map((x, i) => `2026-10-11T00:00:0${i}Z ${x}`).join('\n'),
	};
	const report = { ...REPORT, findings: REPORT.findings.map(f => ({ ...f, steps: [{ kind: 'verify', text: 'it works', result: 'fail', finding: f.n, shots: [`shots/S0${f.n}-01.png`] }] })) };
	const fixed = await runWith(report, {
		verify: () => verdicts([[1, 'confirmed', { log: [1, 3], shots: [{ file: 'S01-01.png', shows: 'a spinner' }] }], [2, 'confirmed', { shots: [{ file: 'S02-01.png', shows: 'no file' }] }]]),
		recheck: step => {
			assert.match(step.prompt, /^Your reply for Finding 2 gave no actions\.log lines\./);
			return verdicts([[1, 'confirmed', { log: [1, 3], shots: [{ file: 'S01-01.png', shows: 'a spinner' }] }], [2, 'confirmed', { log: [3, 5], shots: [{ file: 'S02-01.png', shows: 'no file' }] }]], 'No process issues.');
		},
		edit: EDIT,
	}, { files });
	assert.deepEqual(fixed.purposes, ['verify', 'recheck', 'edit']);
	assert.equal(fixed.report.verification.unchecked, undefined);
	const skipped = await runWith(report, { verify: () => verdicts([[1, 'confirmed'], [2, 'confirmed', { log: [3, 5] }]], 'No process issues.'), recheck: () => 'no block', edit: EDIT }, { files });
	assert.deepEqual(skipped.report.verification.unchecked, { log: [1], shots: [1, 2] });
	assert.deepEqual(skipped.report.findings.map(f => f.verified), ['confirmed', 'confirmed']);
});
