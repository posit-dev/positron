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
//     [--skip-checkout-check]
//     checks the checkout is at --head, built, and has its native binaries,
//     makes a run directory, prints it, explores with the brief, then runs the
//     rest and renders the report. --base-name is the base branch, for the
//     change mark. The time limit is in the file it prints, read throughout:
//     write other minutes to it to change it, or 0 to stop exploring now. It
//     is kept out of the run directory, since an explorer that finds its
//     budget rushes and wraps up early.
//   node pipeline.mjs run <run dir> --repo <checkout> --base <sha> --head <sha>
//     [--base-name <ref>] [--duration-ms <n> --turns <n> --model <id>] [--no-agent-prompts]
//     replays a run whose report.json is as its explorer left it; --duration-ms,
//     --turns and --model are that explorer's, for the Run tile.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, machine, release, type } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runClaude, stopAgents } from './claude-cli.mjs';
import { applyEditReply, writeEditPrompt } from './edit.mjs';
import { applyVerifyReply, parseVerifyReply, readReport, reportPath, writeReport, writeVerifyPrompt } from './finish.mjs';
import { readCheckedReport } from './lint-json.mjs';

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
	return `Read \`${join(dir, 'isolation.md')}\`, revise those findings' verdicts, and name the Cause and Feature it points to, with a new feature when the Feature changes and a new title when the title names the wrong trigger. If a cause is broader than the cases in its table, narrow it. Reply again in full, in the same format: the json block, then your notes.`;
}

/** What the verifier is told when its last message has no json block. */
export const REFORMAT_MESSAGE = 'Your last message has no json block, and only the last message is read. Reply again in full, in the format your instructions give: the json block, then your notes.';

/** What the isolator is told once its time is up. */
export function isolateTimeUpMessage(dir) {
	return `Time is up: your ${ISOLATE_MINUTES} minutes have run out. Run no more cases. Write \`${join(dir, 'isolation.md')}\` now with what you have, and list the findings you did not reach.`;
}

/** What the explorer is told once its time is up, as CI's is; the limit can change, so no minutes. */
export const EXPLORE_TIME_UP = 'Time is up: your time for exploring has run out. Stop exploring now. Finish the ledger, putting every scenario you did not reach under Not run, then write report.json and check it. The run is stopped in 10 minutes.';

/**
 * The first lines of the ledger's Environment, from facts read before the
 * run: Positron's version, build and commit, the OS, and the kernels the
 * checkout ships. The issue button copies them into System details, so they
 * come from the files, not from the agent. An unread value is `not recorded`.
 */
export function environmentLines({ product, codeVersion, commit, os, ark, kallichore }) {
	// A dev build's number is 0, which is a value.
	const or = value => (value === undefined || value === null || value === '' ? 'not recorded' : value);
	const kernels = [ark && `Ark ${ark}`, kallichore && `Kallichore ${kallichore}`].filter(Boolean);
	return [
		`- Positron ${or(product?.positronVersion)} build ${or(product?.positronBuildNumber)}, dev build of ${or(commit)} (Code - OSS ${or(codeVersion)}), on ${or(os)}.`,
		...(kernels.length ? [`- Kernels: ${kernels.join(', ')}.`] : []),
	];
}

/** environmentLines' facts, read from the checkout at `repo` and this machine. */
export function readEnvironment(repo) {
	const tryRead = (read, fallback = '') => {
		try {
			return read();
		} catch {
			return fallback;
		}
	};
	const file = path => readFileSync(join(repo, path), 'utf8');
	const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	const osName = tryRead(() => (process.platform === 'darwin'
		? `${run('sw_vers', ['-productName'])} ${run('sw_vers', ['-productVersion'])}`
		: process.platform === 'linux'
			? /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(readFileSync('/etc/os-release', 'utf8'))[1]
			: `${type()} ${release()}`));
	return {
		product: tryRead(() => JSON.parse(file('product.json')), null),
		codeVersion: tryRead(() => JSON.parse(file('package.json')).version),
		commit: tryRead(() => run('git', ['-C', repo, 'rev-parse', '--short=10', 'HEAD'])),
		os: osName && `${osName} (${type()} ${machine()})`,
		ark: tryRead(() => file('extensions/positron-r/resources/ark/VERSION').trim()),
		kallichore: tryRead(() => file('extensions/positron-supervisor/resources/kallichore/VERSION').trim()),
	};
}

/** The brief's Environment part: the lines the ledger's Environment starts with. */
export function environmentBrief(lines) {
	return [
		'## Environment',
		'',
		'Read from the checkout and this machine before the run. Start the ledger\'s `## Environment` with these lines as they are, leaving out Ark when the run uses no R:',
		'',
		...lines,
	].join('\n');
}

/**
 * Sets report.json's Branch verification to `body`: the pipeline checks the
 * build before the explorer starts, so the explorer does not. No report, no change.
 */
export function recordBranchCheck(dir, body) {
	const path = reportPath(dir);
	if (!existsSync(path)) {
		return;
	}
	const report = readReport(path);
	const details = (report.header?.details ?? []).filter(d => d.title !== 'Branch verification');
	writeReport(path, { ...report, header: { ...report.header, details: [...details, { title: 'Branch verification', body }] } });
}

/** The explorer's prompt: explorer.md, the brief, the Environment lines, and what a local run sets up for it. */
export function explorePrompt(dir, brief, environment = []) {
	return [
		readFileSync(EXPLORER_PATH, 'utf8').trim(),
		'',
		'---',
		'',
		'# Brief',
		'',
		brief.trim(),
		'',
		...(environment.length ? [environmentBrief(environment), ''] : []),
		`Run directory: \`${dir}\``,
		'',
		`The renderer is \`${RENDER}\`; \`lint-json.mjs\` and \`report.schema.json\` are beside it.`,
		'',
		'Write the report to `report.json` in the run directory. Return a two or three line summary and nothing else.',
		'',
	].join('\n');
}

/**
 * Explores with `brief` into `dir`, and returns the explorer's
 * `{ role, model, durationMs, turns, costUsd }`, or null when it failed. Its
 * time limit is the minutes in `timeLimitPath`, if any.
 */
export async function explore(dir, { brief, repo, runAgent, model = 'opus', timeLimitPath = null, environment = environmentLines(readEnvironment(repo)), log = () => { } }) {
	const prompt = explorePrompt(dir, brief, environment);
	writeFileSync(join(dir, 'explore-prompt.md'), prompt);
	log('new explore agent');
	try {
		const result = await runAgent({ role: 'explore', purpose: 'explore', model, prompt, tools: READ_TOOLS, cwd: repo, timeLimitPath, timeUpMessage: EXPLORE_TIME_UP });
		writeFileSync(join(dir, 'explore-reply.md'), String(result.text ?? '').trim());
		return { role: 'explore', model, durationMs: result.durationMs ?? null, turns: result.turns ?? null, costUsd: result.costUsd ?? null, ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
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
		`Report: \`${reportPath(dir)}\``,
		`Findings: ${findings.map(n => `Finding ${n}`).join(', ')}`,
		'',
		'The verifier\'s reply, which says for each of them what evidence is missing. Run that control first:',
		'',
		reply,
		'',
	].join('\n');
}

/**
 * Runs every step after the explorer on `dir`, whose report.json it rewrites,
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
			passes.push({ role: step.role, model: result.model ?? model, durationMs: result.durationMs ?? null, turns: result.turns ?? null, costUsd: result.costUsd ?? null });
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
	const unresolved = [...parseVerifyReply(best).findings].filter(([, f]) => f.verified === 'unresolved').map(([n]) => n);
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
	// Only the last message is read; one sent after the block (a background
	// command finishing, say) leaves none, so ask once for the reply again.
	if (best && session && parseVerifyReply(best).problem) {
		best = (await ask({ ...verifier, purpose: 'reformat', resume: session, prompt: REFORMAT_MESSAGE })).text || best;
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
 * report.json's `cost.passes`: the explorer's, then each later role's summed
 * over its sessions, in the order they first ran.
 */
export function costPasses(explorer, passes) {
	const sum = (own, key) => (own.some(p => typeof p[key] === 'number') ? own.reduce((total, p) => total + (p[key] ?? 0), 0) : null);
	return [
		{ label: 'explore', model: explorer?.model ?? null, costUsd: explorer?.costUsd ?? null, turns: explorer?.turns ?? null, ...(explorer?.maxTurns ? { maxTurns: explorer.maxTurns } : {}), durationMs: explorer?.durationMs ?? null },
		...[...new Set(passes.map(p => p.role))].map(role => {
			const own = passes.filter(p => p.role === role);
			return { label: role, model: own[0].model ?? null, costUsd: sum(own, 'costUsd'), turns: sum(own, 'turns'), durationMs: sum(own, 'durationMs') };
		}),
	];
}

/**
 * A run's end, local or CI, once the explorer is done: check report.json,
 * record how the build was checked, add what the runner knows of the header
 * (CI's PR), run the later passes, and write every pass's cost into it.
 * `explored` is the explorer's pass, as `explore` returns it. Returns the
 * report, or null when the explorer wrote none.
 */
export async function completeRun(dir, explored, { branchCheck = '', header = {}, log = () => { }, ...finish }) {
	if (!readCheckedReport(dir, { log })) {
		return null;
	}
	if (branchCheck) {
		recordBranchCheck(dir, branchCheck);
	}
	const path = reportPath(dir);
	if (Object.keys(header).length) {
		const json = readReport(path);
		writeReport(path, { ...json, header: { ...json.header, ...header } });
	}
	const passes = await finishRun(dir, { ...finish, log });
	const json = { ...readReport(path), cost: { passes: costPasses(explored, passes) } };
	writeReport(path, json);
	return json;
}

/** A local run's end: `completeRun`, then the page. */
async function finishLocal(dir, explored, { agentPrompts, ...complete }) {
	if (!await completeRun(dir, explored, complete)) {
		stopInstances(dir);
		complete.log(`the explorer wrote no report.json; what it left is in ${dir}`);
		return 1;
	}
	// The page is written even when render exits 1 for a missing file; it says which.
	try {
		execFileSync('node', [RENDER, reportPath(dir), ...(agentPrompts ? [] : ['--no-agent-prompts'])], { stdio: 'inherit' });
	} catch (err) {
		return err.status ?? 1;
	}
	return 0;
}

// The native binaries a run needs, each with the command that installs it.
const CHECKOUT_BINARIES = [
	{ path: 'extensions/positron-python/python-env-tools/pet', name: 'the Python locator (pet)', fix: 'cd extensions/positron-python && npm run install-pet' },
	{ path: 'extensions/positron-r/resources/ark/ark', name: 'the R kernel (ark)', fix: 'cd extensions/positron-r && npm run install-kernel' },
	{ path: 'extensions/positron-supervisor/resources/kallichore/kcserver', name: 'the kernel supervisor (kallichore)', fix: 'cd extensions/positron-supervisor && npm run install-kallichore' },
];

/**
 * What would make a fresh run explore the wrong code or lose its time to
 * setup, each with its fix: the checkout not at `head`, a build older than the
 * last change to src/, or a native binary missing. `git(args)` returns git's
 * output in the checkout, or '' when it fails; `mtimeMs(path)` a file's time,
 * or null when it is missing; `builtMs` the newest file's time under out/, or
 * null with no build. The watch build rewrites only what changed, so no one
 * file's time says when it last ran.
 */
export function checkoutProblems({ head, git, mtimeMs, builtMs }) {
	const problems = [];
	const at = git(['rev-parse', 'HEAD']);
	const want = git(['rev-parse', `${head}^{commit}`]);
	if (!at) {
		return ['it is not a git checkout'];
	}
	if (!want) {
		problems.push(`--head ${head} is not a commit in it; fetch it, check it out, then build`);
	} else if (at !== want) {
		problems.push(`the checkout is at ${at.slice(0, 10)}, not --head ${want.slice(0, 10)}; check out the head, then build`);
	}
	const changed = Number(git(['log', '-1', '--format=%ct', '--', 'src'])) * 1000;
	if (builtMs === null) {
		problems.push('there is no build (out/); build it with npm run build-start, then npm run build-check');
	} else if (builtMs < changed) {
		problems.push(`the build is older than the last change to src/; rebuild with npm run build-start, then npm run build-check`);
	}
	for (const b of CHECKOUT_BINARIES) {
		if (mtimeMs(b.path) === null && mtimeMs(`${b.path}.exe`) === null) {
			problems.push(`${b.name} is missing (${b.path}); install it: ${b.fix}`);
		}
	}
	return problems;
}

function checkCheckout(repo, head) {
	return checkoutProblems({
		head,
		git: args => {
			try {
				return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
			} catch {
				return '';
			}
		},
		mtimeMs: path => existsSync(join(repo, path)) ? statSync(join(repo, path)).mtimeMs : null,
		builtMs: newestMs(join(repo, 'out', 'vs')),
	});
}

/** The newest file's time under `dir`, or null when there is none. */
function newestMs(dir) {
	if (!existsSync(dir)) {
		return null;
	}
	let newest = null;
	for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			const ms = statSync(join(entry.parentPath, entry.name)).mtimeMs;
			newest = newest === null || ms > newest ? ms : newest;
		}
	}
	return newest;
}

async function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			repo: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' }, 'base-name': { type: 'string' },
			brief: { type: 'string' }, 'time-limit': { type: 'string' },
			'duration-ms': { type: 'string' }, turns: { type: 'string' }, model: { type: 'string' },
			'no-agent-prompts': { type: 'boolean' }, 'skip-checkout-check': { type: 'boolean' },
		},
	});
	const [command, given] = positionals;
	const limit = values['time-limit'] ?? String(EXPLORE_MINUTES);
	const replay = given && existsSync(join(given, 'report.json'));
	const fresh = !given && values.brief && existsSync(values.brief) && (limit === 'none' || /^\d+$/.test(limit));
	if (command !== 'run' || !(replay || fresh)) {
		console.error('usage: node pipeline.mjs run --brief <file> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>] [--time-limit <minutes>|none] [--no-agent-prompts] [--skip-checkout-check]');
		console.error('       node pipeline.mjs run <run dir> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>] [--duration-ms <n> --turns <n> --model <id>] [--no-agent-prompts]');
		return 2;
	}
	if (!values.repo || !values.base || !values.head) {
		console.error('pipeline: verifying needs --repo, --base and --head');
		return 2;
	}
	const log = line => console.error(`pipeline: ${line}`);
	// Before anything is spent: an explorer finds these only after launching.
	if (fresh && !values['skip-checkout-check']) {
		const problems = checkCheckout(values.repo, values.head);
		if (problems.length) {
			console.error(`pipeline: ${values.repo} is not ready to explore, so nothing was run:\n${problems.map(p => `  - ${p}`).join('\n')}\nFix these, or pass --skip-checkout-check to run anyway.`);
			return 1;
		}
	}
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
	}
	const explorer = explored ?? { model: values.model ?? 'opus', durationMs: number(values['duration-ms']), turns: number(values.turns), costUsd: null };
	// A replay keeps the check its run recorded.
	const branchCheck = !fresh ? null : values['skip-checkout-check']
		? 'Not checked: the run was started with `--skip-checkout-check`.'
		: `Checked by the pipeline before the run: the checkout was at \`${values.head.slice(0, 10)}\`, and \`out/\` was newer than the last commit to touch \`src/\`.`;
	return finishLocal(dir, explorer, { repo: values.repo, base: values.base, head: values.head, baseName: values['base-name'], runAgent, agentPrompts: !values['no-agent-prompts'], branchCheck, log });
}

if (process.argv[1] === SELF) {
	process.exitCode = await main(process.argv.slice(2));
}
