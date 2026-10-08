/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Node side shared by the dp-*.ts command files: sending one Playwright
// function to the attached session with `playwright-cli run-code`, the action
// log, command-line parsing and help. The page side, the `lib` every page
// function gets, is page-lib.ts; the selectors and names both use are
// selectors.ts.
//
// A function sent to the page is turned into source text, so it may use only
// its arguments: `page`, `args` and `lib`.

import { execFileSync } from 'child_process';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import type { Page } from 'playwright';
import { makeLib, type Lib } from './page-lib.ts';
import { css, names } from './selectors.ts';

export type Json = { ok: boolean; [key: string]: unknown };
export type PageFn<A> = (page: Page, args: A, lib: Lib) => Promise<Json>;

const here = dirname(new URL(import.meta.url).pathname);
const repo = resolve(here, '../../../..');
const cli = existsSync(join(repo, 'node_modules/.bin/playwright-cli')) ? join(repo, 'node_modules/.bin/playwright-cli') : 'playwright-cli';
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
// makeLib's source with the registry as its argument, built once per command.
const libSource = `(${makeLib.toString()})(page, ${JSON.stringify({ css, names })})`;

// ---- Talking to the session ----------------------------------------------------

/** Ends a command with an exit code and what to print; reason is the error of one that prints it to stderr. */
export class Exit extends Error {
	readonly code: number;
	readonly out: Json | string;
	readonly reason: string;
	constructor(code: number, out: Json | string, reason = '') { super('exit'); this.code = code; this.out = out; this.reason = reason; }
}

/** Ends a command whose answer is text, not JSON: the error goes to stderr as "X.sh: error". */
export function failText(script: string, error: string, code = 1): never {
	process.stderr.write(`${script}: ${error}\n`);
	throw new Exit(code, '', error);
}

// The last page call: its session, and whether lib.explain saw its result fail.
let last: { session: string; explained: boolean } | null = null;

/**
 * Runs fn in the session's page and returns what it returned. An error thrown
 * in the page becomes a plain failure (lib.failure: a Playwright timeout as one
 * sentence, with no ANSI codes or call log). A failure goes through
 * lib.explain, which names a modal dialog that is open, since a dialog is the
 * usual reason a helper's keys and clicks went nowhere.
 */
export function inPage<A>(session: string, fn: PageFn<A>, args: A): Json {
	const r = runInPage(session, fn, args);
	last = { session, explained: !r.ok };
	return r;
}

// runs in run-code
const explainIt: PageFn<{ r: Json }> = async (_page, a, lib) => lib.explain(a.r) as Promise<Json>;

/**
 * A command's failure that its own code decided after a page call succeeded
 * (the active editor is another file) has not been through lib.explain: ask the
 * page once more, so it too names an open modal dialog. dp.ts runs every
 * command's answer through this.
 */
export function explainFailure(out: Json): Json {
	if (out.ok || out.dialogs || !last || last.explained) { return out; }
	const r = runInPage(last.session, explainIt, { r: out });
	return r.dialogs ? r : out;
}

function runInPage<A>(session: string, fn: PageFn<A>, args: A): Json {
	const code = `async page => { const lib = ${libSource}; let r;
		try { r = await (${fn.toString()})(page, ${JSON.stringify(args)}, lib); }
		catch (e) { r = await lib.failure(e); }
		return JSON.stringify(await lib.explain(r)); }`;
	let raw: string;
	try {
		raw = execFileSync(cli, [...(session ? [`-s=${session}`] : []), '--raw', 'run-code', code], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; message: string };
		const text = `${err.stdout ?? ''}${err.stderr ?? ''}`.replace(/^### Error\s*/m, '').replace(/\u001b\[[0-9;]*m/g, '').trim() || err.message;
		return { ok: false, error: text.split('\n').filter(Boolean).slice(0, 3).join(' | '), cliFailed: true };
	}
	try {
		const once = JSON.parse(raw.trim());
		return typeof once === 'string' ? JSON.parse(once) : once;
	} catch {
		// The CLI answers some failures, such as a session that is not attached, in plain text.
		return { ok: false, error: raw.trim().split('\n')[0] || 'no result from the page' };
	}
}

/**
 * Runs a playwright-cli command for the session (attach, tab-select), and
 * returns what it printed, or throws with its error.
 */
export function cliRun(session: string, args: string[]): string {
	try {
		return execFileSync(cli, [`-s=${session}`, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; message: string };
		throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(0, 3).join(' | ') || err.message);
	}
}

// The action log, $DRIVE_POSITRON_LOG: one line per action, reading and failure.
// A recipe that makes several calls (debug.sh, plots.sh) quiets what its calls
// would log and logs its own lines through `dp.ts log`:
//   DRIVE_POSITRON_QUIET_READS    its calls' readings and failures
//   DRIVE_POSITRON_QUIET_ACTIONS  its calls' actions
//   DRIVE_POSITRON_LOG_AS         the name a wrapper's calls log under (view-read.sh)

function write(script: string, session: string, what: string): void {
	const file = process.env.DRIVE_POSITRON_LOG;
	if (!file) { return; }
	// One line per entry, so every line starts with its time (lint checks the order).
	appendFileSync(file, `${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} ${process.env.DRIVE_POSITRON_LOG_AS || script}${session ? ' -s=' + session : ''}: ${what.replace(/\s*\n\s*/g, ' ')}\n`);
}

/**
 * Logs an action, and with readout the key values it returned ("-> plot 2,
 * top-left rgb(255,0,0)"), cut to 160 characters, so a value a report cites
 * from an action can be found in the log as a reading's can.
 */
export function log(script: string, session: string, what: string, readout?: string): void {
	if (process.env.DRIVE_POSITRON_QUIET_ACTIONS) { return; }
	write(script, session, readout ? `${what} -> ${cut(readout)}` : what);
}

/** A recipe's own line (`dp.ts log`), which no quiet setting hides. */
export function logLine(script: string, session: string, what: string): void {
	write(script, session, cut(what));
}

/**
 * Logs a reading: one line, "read " and the key values read, cut to 160
 * characters, so a number a report cites can be found in the log. A recipe
 * that reads on its way (debug.sh state reads through ui.sh and editor.sh)
 * exports DRIVE_POSITRON_QUIET_READS for its own calls and logs one line
 * itself, through `dp.ts log`.
 */
export function logRead(script: string, session: string, what: string): void {
	if (process.env.DRIVE_POSITRON_QUIET_READS) { return; }
	write(script, session, cut('read ' + what));
}

/**
 * Logs a failed call, with its arguments and error, so a negative check
 * ("editor.sh goto 102 fails") has its evidence in the log. dp.ts logs every
 * command's failure here; a recipe logs its own through `dp.ts fail`, and its
 * calls' failures are quiet under DRIVE_POSITRON_QUIET_READS, since a recipe
 * expects some of them (a view not shown yet).
 */
export function logFailure(script: string, session: string, args: string[], error: string): void {
	if (process.env.DRIVE_POSITRON_QUIET_READS) { return; }
	write(script, session, failureText(args, error));
}

/** "FAILED goto 102: no line 102", the arguments quoted as a shell would need. */
export function failureText(args: string[], error: string): string {
	const shown = args.map(a => /^[\w.,:/@%+=-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
	return cut(`FAILED${shown ? ' ' + shown : ''}: ${error || 'failed'}`);
}

/**
 * An accessibility tree as one line: without the pane's own header lines,
 * roles with no name, and text that repeats the name above it.
 */
export function treeLine(tree: unknown): string {
	const out: string[] = [];
	for (const l of String(tree ?? '').split('\n').map(x => x.trim().replace(/^- /, ''))) {
		if (!l || /^[a-z]+$/.test(l) || /^(button ".* Section"|heading "|toolbar ")/.test(l)) { continue; }
		const text = l.match(/^text: (.*)$/);
		if (text && out.length && out[out.length - 1].includes(`"${text[1].trim()}"`)) { continue; }
		out.push(l);
	}
	return out.join(' | ');
}

/** One line of at most 160 characters. */
export function cut(text: string): string {
	const one = text.replace(/\s+/g, ' ').trim();
	return one.length > 160 ? one.slice(0, 157) + '...' : one;
}

// ---- Command lines -------------------------------------------------------------

export interface Parsed { session: string; flags: Record<string, string | true>; rest: string[] }

/**
 * Parses --flag VALUE, --flag=VALUE and bare --switch; values follow the flags
 * listed. Positional arguments beyond `most` are a usage error (exit 2), so a
 * stray word is refused rather than typed or run; `most` is a count, or a count
 * per command word (the first positional, counted too). A command word not
 * listed is left to the command. A flag that is neither in `withValue` nor in
 * `switches` (the flags that take no value; --help always counts) is a usage
 * error too, so a misspelled flag (--clera, --usr) is refused rather than
 * ignored, and so is a value flag last on the line with no value (--click):
 * read as '', it would act like the flag left out. An empty value given on
 * purpose (--flag '', --flag=) is the command's to refuse, with textFlag().
 */
export function parse(argv: string[], withValue: string[], most: number | Record<string, number> = 0, switches: string[] = []): Parsed {
	const flags: Record<string, string | true> = {};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
		if (a === '-h') { flags.help = true; continue; }
		// A shell that does not split a variable (zsh) can pass a flag and its value as one
		// argument; that is never a command word, so say what happened.
		if (/^--[\w-]+\s/.test(a)) { throw new Exit(2, { ok: false, error: `${JSON.stringify(a)} is one argument; pass the flag and its value as two (or --flag=value)` }); }
		const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
		if (!m) { rest.push(a); continue; }
		if (m[2] !== undefined) { flags[m[1]] = m[2]; } else if (withValue.includes(m[1])) { flags[m[1]] = i + 1 < argv.length ? argv[++i] : true; } else { flags[m[1]] = true; }
	}
	if (!flags.help) {
		const known = [...withValue, ...switches.filter(f => f !== 'help')];
		const unknown = Object.keys(flags).find(f => !known.includes(f));
		if (unknown) { throw new Exit(2, { ok: false, error: `unknown flag --${unknown}; it takes ${known.map(f => `--${f}`).join(', ')} (see --help)` }); }
		const bare = withValue.find(f => flags[f] === true);
		if (bare) { throw new Exit(2, { ok: false, error: `--${bare} needs a value` }); }
	}
	const max = typeof most === 'number' ? most : most[rest[0]] ?? Infinity;
	if (!flags.help && rest.length > max) { throw new Exit(2, { ok: false, error: `unexpected argument ${JSON.stringify(rest[max])}${max ? ` after ${JSON.stringify(rest.slice(0, max).join(' '))}` : ''}; see --help for the arguments and flags it takes` }); }
	const session = String(flags.session ?? process.env.PW_SESSION ?? '');
	return { session, flags, rest };
}

/** A script's header: the comment block under its #! line, without the "# ". */
export function header(file: string): string {
	const lines = readFileSync(file, 'utf8').split('\n').slice(1);
	return lines.slice(0, lines.findIndex(l => !l.startsWith('#'))).map(l => l.replace(/^# ?/, '')).join('\n') + '\n';
}

/**
 * Prints a .sh file's header, the one place its help lives, and ends the
 * command. Every --help goes through here: a dp.ts command calls it, and a
 * bash script's -h|--help case runs `node dp.ts help "$0"`.
 */
export function usage(script: string): never {
	process.stdout.write(header(join(here, basename(script))));
	throw new Exit(0, '');
}

/** Blocks for this many seconds, between two page calls. */
export function pause(seconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/**
 * A flag's value in seconds, or the default when it is absent. Anything but a
 * positive number is a usage error (exit 2): Number() reads "abc" as NaN and ""
 * as 0, and a wait bounded by either ends before it starts.
 */
export function seconds(p: Parsed, flag: string, fallback: number): number {
	return secondsOf(p.flags[flag], `--${flag}`, fallback);
}

/**
 * The same check for a duration given as a positional argument (`wait N SECS`):
 * `name` is how the error names it. Call it before anything is done, so a bad
 * value is refused with nothing changed.
 */
export function secondsOf(v: string | true | undefined, name: string, fallback: number): number {
	if (v === undefined) { return fallback; }
	const n = typeof v === 'string' && /^\s*\d*\.?\d+\s*$/.test(v) ? Number(v) : NaN;
	if (!(n > 0)) { throw new Exit(2, { ok: false, error: `${name} must be a positive number of seconds, not ${JSON.stringify(v === true ? '' : v)}` }); }
	return n;
}

/**
 * A text flag's value, or '' when it is absent. Given with no value (last on
 * the line, or --flag=) or an empty one is a usage error (exit 2): '' would
 * read as the flag left out, and the command would act on whatever is active.
 */
export function textFlag(p: Parsed, flag: string): string {
	const v = p.flags[flag];
	if (v === undefined) { return ''; }
	if (v === true || v === '') { throw new Exit(2, { ok: false, error: `--${flag} needs a value; leave the flag out for none` }); }
	return v;
}

export function language(p: Parsed): 'python' | 'r' {
	const l = String(p.flags.language ?? '').toLowerCase();
	if (l !== 'python' && l !== 'r') { throw new Exit(2, { ok: false, error: '--language must be python or r' }); }
	return l;
}

