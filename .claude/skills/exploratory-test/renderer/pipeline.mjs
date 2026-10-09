/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The steps after the explorer, shared by CI (run.mjs) and a local run: stop
// its instances, verify, isolate what the verifier could not settle, apply the
// verdicts, edit. The caller only says how to run an agent.
//
// Local usage, each agent a `claude -p` session:
//   node pipeline.mjs run --brief <file> --repo <checkout> --base <sha> --head <sha>
//     [--base-name <ref>] [--time-limit <minutes>|none] [--no-agent-prompts]
//     makes a run directory, prints it, explores with the brief, then runs the
//     rest and renders the report. --base-name is the base branch, for the
//     change mark. The time limit is in the file it prints, read throughout:
//     write other minutes to it to change it, or 0 to stop exploring now. It
//     is kept out of the run directory, since an explorer that finds its
//     budget rushes and wraps up early.
//   node pipeline.mjs run <run dir> --repo <checkout> --base <sha> --head <sha>
//     [--base-name <ref>] [--duration-ms <n> --turns <n> --model <id>] [--no-agent-prompts]
//     replays a run whose report.md is as its explorer left it; --duration-ms,
//     --turns and --model are that explorer's, for the Run tile.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runClaude, stopAgents } from './claude-cli.mjs';
import { applyEditReply, writeEditPrompt } from './edit.mjs';
import { applyVerifyReply, parseVerdicts, writeVerifyPrompt } from './finish.mjs';

export const ISOLATE_MINUTES = 12;
export const EXPLORE_MINUTES = 30;
const READ_TOOLS = ['Bash', 'Read', 'Glob', 'Grep'];
const EXPLORER_PATH = fileURLToPath(new URL('../explorer.md', import.meta.url));
const ISOLATOR_PATH = fileURLToPath(new URL('../isolator.md', import.meta.url));
const STOP_INSTANCES = fileURLToPath(new URL('./stop-instances.sh', import.meta.url));
const RENDER = fileURLToPath(new URL('./render.mjs', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const STATE_DIR = join(homedir(), '.local', 'state', 'exploratory-test');

/** What the verifier is sent once the isolator has written isolation.md. */
export function reviseMessage(dir) {
	return `Read \`${join(dir, 'isolation.md')}\`, revise those findings' verdicts, and name the Cause and Feature it points to, with a FEATURE line when the Feature changes and a TITLE line when the title names the wrong trigger. If a cause is broader than the cases in its table, narrow it. Reply again in full, in the same format.`;
}

/** What the isolator is told once its time is up. */
export function isolateTimeUpMessage(dir) {
	return `Time is up: your ${ISOLATE_MINUTES} minutes have run out. Run no more cases. Write \`${join(dir, 'isolation.md')}\` now with what you have, and list the findings you did not reach.`;
}

/** What the explorer is told once its time is up, as CI's is; the limit can change, so no minutes. */
export const EXPLORE_TIME_UP = 'Time is up: your time for exploring has run out. Stop exploring now. Finish the ledger, putting every scenario you did not reach under Not run, then write report.md and check it. The run is stopped in 10 minutes.';

/** The explorer's prompt: explorer.md, the brief, and what a local run sets up for it. */
export function explorePrompt(dir, brief) {
	return [
		readFileSync(EXPLORER_PATH, 'utf8').trim(),
		'',
		'---',
		'',
		'# Brief',
		'',
		brief.trim(),
		'',
		`Run directory: \`${dir}\``,
		'',
		`The renderer is \`${RENDER}\`. Do not render the report; check it: run \`node ${RENDER} --check "${dir}/report.md"\`, fix every line it prints, and run it again until it prints none. It is rendered once its findings are verified.`,
		'',
		'Write the report to `report.md` in the run directory. Return a two or three line summary and nothing else.',
		'',
	].join('\n');
}

/**
 * Explores with `brief` into `dir`, and returns the explorer's
 * `{ role, model, durationMs, turns, costUsd }`, or null when it failed. Its
 * time limit is the minutes in `timeLimitPath`, if any.
 */
export async function explore(dir, { brief, repo, runAgent, model = 'opus', timeLimitPath = null, log = () => { } }) {
	const prompt = explorePrompt(dir, brief);
	writeFileSync(join(dir, 'explore-prompt.md'), prompt);
	log('new explore agent');
	try {
		const result = await runAgent({ role: 'explore', purpose: 'explore', model, prompt, tools: READ_TOOLS, cwd: repo, timeLimitPath, timeUpMessage: EXPLORE_TIME_UP });
		writeFileSync(join(dir, 'explore-reply.md'), String(result.text ?? '').trim());
		return { role: 'explore', model, durationMs: result.durationMs ?? null, turns: result.turns ?? null, costUsd: result.costUsd ?? null };
	} catch (err) {
		log(`the explore agent failed: ${err?.message ?? err}`);
		return null;
	}
}

/**
 * A fresh run directory, named for when it started. Not under ~/.claude:
 * Claude Code blocks an agent's writes there, whatever its permissions.
 */
function makeRunDir() {
	const output = join(STATE_DIR, 'output');
	mkdirSync(output, { recursive: true });
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
	return mkdtempSync(join(output, `${stamp}-`));
}

/** Where a run's time limit is kept, out of the explorer's sight. */
function timeLimitFile(dir) {
	const limits = join(STATE_DIR, 'time-limits');
	mkdirSync(limits, { recursive: true });
	return join(limits, basename(dir));
}

/** Stops what the run's agents launched; a failure only warns, since the report does not depend on it. */
function stopInstances(dir) {
	try {
		execFileSync('bash', [STOP_INSTANCES, dir], { stdio: ['ignore', 'inherit', 'inherit'] });
	} catch {
		console.error('pipeline: some instances could not be stopped; see above');
	}
}

function isolatePrompt(dir, { repo, base, head }, findings, reply) {
	return [
		readFileSync(ISOLATOR_PATH, 'utf8').trim(),
		'',
		'---',
		'',
		'# Brief',
		'',
		`Run directory: \`${dir}\``,
		`Checkout: \`${repo}\``,
		`Base: \`${base}\``,
		`Head: \`${head}\``,
		`Findings: ${findings.map(n => `Finding ${n}`).join(', ')}`,
		'',
		'The verifier\'s reply, which says for each of them what evidence is missing. Run that control first:',
		'',
		reply,
		'',
	].join('\n');
}

/**
 * Runs every step after the explorer on `dir`, whose report.md it rewrites,
 * and returns each agent's `{ role, model, durationMs, turns, costUsd }`.
 *
 * `runAgent({ role, purpose, model, prompt, tools, cwd, resume, timeLimitMinutes, timeUpMessage })`
 * runs one agent and resolves to `{ text, durationMs, turns, costUsd, sessionId }`;
 * `resume` is a session to send `prompt` to. A throw is an agent that failed:
 * verify marks the findings unreviewed, and every later step keeps what it has,
 * so the worst case is the report as the explorer wrote it. Each reply is kept
 * in `<purpose>-reply.md` for whoever debugs the run.
 */
export async function finishRun(dir, { repo, base, head, baseName, runAgent, verify = true, model = 'sonnet', stop = stopInstances, log = () => { } }) {
	const passes = [];
	const ask = async step => {
		log(`${step.resume ? 'message to' : 'new'} ${step.role} agent: ${step.purpose}`);
		try {
			const result = await runAgent({ model, ...step });
			passes.push({ role: step.role, model, durationMs: result.durationMs ?? null, turns: result.turns ?? null, costUsd: result.costUsd ?? null });
			const text = String(result.text ?? '').trim();
			writeFileSync(join(dir, `${step.purpose}-reply.md`), text);
			return { text, sessionId: result.sessionId ?? null, error: '' };
		} catch (err) {
			const error = String(err?.message ?? err);
			log(`the ${step.role} agent failed: ${error}`);
			return { text: '', sessionId: null, error };
		}
	};
	if (verify && (!repo || !base || !head)) {
		throw new Error('pipeline: verifying needs --repo, --base and --head');
	}
	stop(dir);
	if (verify) {
		await verifyFindings(dir, { repo, base, head, baseName }, ask, stop, log);
	}
	await editReport(dir, ask, log);
	return passes;
}

async function verifyFindings(dir, range, ask, stop, log) {
	const promptPath = writeVerifyPrompt(dir, range);
	if (!promptPath) {
		return;
	}
	const verifier = { role: 'verify', tools: READ_TOOLS, cwd: range.repo };
	const first = await ask({ ...verifier, purpose: 'verify', prompt: readFileSync(promptPath, 'utf8') });
	// The latest usable reply: a failed revision keeps the first verdicts.
	let best = first.text;
	const session = first.sessionId;
	const unresolved = [...parseVerdicts(best)].filter(([, word]) => word === 'unresolved').map(([n]) => n);
	if (unresolved.length) {
		const prompt = isolatePrompt(dir, range, unresolved, best);
		writeFileSync(join(dir, 'isolate-prompt.md'), prompt);
		await ask({ role: 'isolate', purpose: 'isolate', prompt, tools: READ_TOOLS, cwd: range.repo, timeLimitMinutes: ISOLATE_MINUTES, timeUpMessage: isolateTimeUpMessage(dir) });
		stop(dir);
		if (!existsSync(join(dir, 'isolation.md'))) {
			log('the isolator wrote no isolation.md; applying the verifier\'s first reply');
		} else if (session) {
			best = (await ask({ ...verifier, purpose: 'revise', resume: session, prompt: reviseMessage(dir) })).text || best;
		}
	}
	let result = applyVerifyReply(dir, best, { error: best ? '' : first.error });
	// Numbers that do not match the report get one retry, then mark it unreviewed.
	if (result.mismatch) {
		const retry = session ? await ask({ ...verifier, purpose: 'renumber', resume: session, prompt: `${result.mismatch} Reply again in full, in the same format.` }) : { text: '' };
		result = applyVerifyReply(dir, retry.text || best, { giveUp: true });
	}
	(result.logLines ?? []).forEach(line => log(line));
}

/** Rewrites the findings' openings; an edit the guard rejects gets one retry. */
async function editReport(dir, ask, log) {
	const promptPath = writeEditPrompt(dir);
	if (!promptPath) {
		return;
	}
	const editor = { role: 'edit', tools: [], cwd: dir };
	const { rejected, retry } = applyEditReply(dir, (await ask({ ...editor, purpose: 'edit', prompt: readFileSync(promptPath, 'utf8') })).text);
	rejected.forEach(line => log(line));
	if (retry) {
		const text = (await ask({ ...editor, purpose: 'edit-retry', prompt: readFileSync(retry, 'utf8') })).text;
		applyEditReply(dir, text, { last: true }).rejected.forEach(line => log(line));
	}
}

/**
 * The Run tile's render.mjs flags from the explorer's pass and `passes`: the
 * verifier's summed over its sessions, and the isolator's, with what they cost. None without the
 * explorer's time, which the footer is built on.
 */
export function renderFlags(explorer, passes) {
	const sum = role => {
		const own = passes.filter(p => p.role === role);
		return own.length ? {
			model: own[0].model,
			durationMs: own.reduce((total, p) => total + (p.durationMs ?? 0), 0),
			turns: own.some(p => p.turns !== null) ? own.reduce((total, p) => total + (p.turns ?? 0), 0) : null,
			costUsd: own.some(p => p.costUsd !== null) ? own.reduce((total, p) => total + (p.costUsd ?? 0), 0) : null,
		} : null;
	};
	if (explorer?.durationMs === null || explorer?.durationMs === undefined) {
		return [];
	}
	const flags = (prefix, pass) => pass ? [
		...(pass.model ? [`--${prefix}model`, pass.model] : []),
		`--${prefix}duration-ms`, String(pass.durationMs),
		...(pass.turns !== null && pass.turns !== undefined ? [`--${prefix}turns`, String(pass.turns)] : []),
		...(pass.costUsd !== null && pass.costUsd !== undefined ? [`--${prefix}cost-usd`, String(pass.costUsd)] : []),
	] : [];
	return [...flags('', explorer), ...flags('verify-', sum('verify')), ...flags('isolate-', sum('isolate'))];
}

async function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			repo: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' }, 'base-name': { type: 'string' },
			brief: { type: 'string' }, 'time-limit': { type: 'string' },
			'duration-ms': { type: 'string' }, turns: { type: 'string' }, model: { type: 'string' },
			'no-agent-prompts': { type: 'boolean' },
		},
	});
	const [command, given] = positionals;
	const limit = values['time-limit'] ?? String(EXPLORE_MINUTES);
	const replay = given && existsSync(join(given, 'report.md'));
	const fresh = !given && values.brief && existsSync(values.brief) && (limit === 'none' || /^\d+$/.test(limit));
	if (command !== 'run' || !(replay || fresh)) {
		console.error('usage: node pipeline.mjs run --brief <file> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>] [--time-limit <minutes>|none] [--no-agent-prompts]');
		console.error('       node pipeline.mjs run <run dir> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>] [--duration-ms <n> --turns <n> --model <id>] [--no-agent-prompts]');
		return 2;
	}
	if (!values.repo || !values.base || !values.head) {
		console.error('pipeline: verifying needs --repo, --base and --head');
		return 2;
	}
	const log = line => console.error(`pipeline: ${line}`);
	const number = value => value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value);
	const dir = fresh ? makeRunDir() : given;
	// The feed names the run directory $RUN and the checkout's files by their paths in it.
	const runAgent = step => runClaude({ ...step, feedPaths: { [dir]: '$RUN', [`${values.repo}/`]: '' } });
	let explored;
	// A stopped run stops its agents and the instances they launched, rather
	// than leaving them running on their own.
	for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
		process.once(signal, () => {
			log(`stopped (${signal}); stopping its agents and instances`);
			stopAgents();
			stopInstances(dir);
			process.exit(code);
		});
	}
	if (fresh) {
		const timeLimitPath = timeLimitFile(dir);
		if (limit !== 'none') {
			writeFileSync(timeLimitPath, `${limit}\n`);
		}
		console.log(`run directory: ${dir}`);
		log(limit === 'none' ? 'exploring with no time limit' : `exploring for ${limit} minutes; write other minutes to ${timeLimitPath} to change it, or 0 to stop now`);
		explored = await explore(dir, { brief: readFileSync(values.brief, 'utf8'), repo: values.repo, runAgent, timeLimitPath, log });
		if (!existsSync(join(dir, 'report.md'))) {
			stopInstances(dir);
			log(`the explorer wrote no report.md; what it left is in ${dir}`);
			return 1;
		}
	}
	const explorer = explored ?? { model: values.model ?? 'opus', durationMs: number(values['duration-ms']), turns: number(values.turns), costUsd: null };
	const passes = await finishRun(dir, { repo: values.repo, base: values.base, head: values.head, baseName: values['base-name'], runAgent, log });
	// The page is written even when render exits 1 for a missing file; it says which.
	const args = [RENDER, join(dir, 'report.md'), ...renderFlags(explorer, passes), ...(values['no-agent-prompts'] ? ['--no-agent-prompts'] : [])];
	try {
		execFileSync('node', args, { stdio: 'inherit' });
	} catch (err) {
		return err.status ?? 1;
	}
	return 0;
}

if (process.argv[1] === SELF) {
	process.exitCode = await main(process.argv.slice(2));
}
