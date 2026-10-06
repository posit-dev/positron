/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// What a night produced, as the step summary, the PR title and body, and the Slack message.
//
//   node .claude/skills/drive-positron/heal/report.ts --dir D --run-url U [--job-failed STEP] [--smoke-red] summary|title|body|slack|notify? [--link-kind compare|pr|patch --link URL]
//
// Exit 2 on a usage error, 1 on anything else. An unreadable input file never
// crashes the report; it is listed under "Report problems".

import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, unknownArg } from '../test/smoke-lib.ts';
import type { Finding, State } from './finding.ts';

export interface Night {
	findings: Finding[]; flakes: { name: string }[]; unconfirmed: { name: string }[]; state: State; smokeRed: boolean; jobFailed: string | null;
	costs: { label: string; usd: number | null }[]; checksDiff: string;
	/** Input files that could not be read; the report says so rather than guessing. */
	problems?: string[];
}

export function counts(n: Night) {
	const fs = n.findings;
	return {
		fixed: fs.filter(f => f.outcome === 'fixed' && !f.rejected).length,
		product: fs.filter(f => f.outcome === 'product').length,
		flake: n.flakes.length + fs.filter(f => f.outcome === 'flake').length,
		resolved: fs.filter(f => f.outcome === 'resolved').length,
		rejected: fs.filter(f => f.rejected).length,
		notAttempted: fs.filter(f => f.notAttempted).length,
	};
}

export function totalCost(costs: Night['costs']) {
	const sum = (p: string) => costs.filter(c => c.label.startsWith(p)).reduce((s, c) => s + (c.usd ?? 0), 0);
	const finder = sum('finder'), fixer = sum('fixer');
	return { finder, fixer, total: finder + fixer };
}

export function shouldNotify(n: Night): boolean {
	return n.smokeRed || n.jobFailed !== null || n.findings.length > 0 || Boolean(n.state.scopeViolation) || Boolean(n.problems?.length);
}

/** Why the fixes are not verified, or null when they are: check.ts and a smoke run passed over each kept fix. */
function unverified(n: Night): string | null {
	if (n.jobFailed) { return `the job broke at "${n.jobFailed}" before the checks finished`; }
	switch (n.state.gate) {
		case 'pass': return null;
		case 'fail': return 'a fix failed its checks';
		case 'none': return 'no fix was accepted';
		default: return 'the fix loop did not finish';
	}
}

const s = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const kept = (f: Finding) => f.outcome === 'fixed' && !f.rejected;
const title = (f: Finding) => f.case ?? f.id;

/** One line on the night: what it found and whether anything is ready. */
function headline(n: Night, short = false): string {
	const c = counts(n);
	const found = [
		c.fixed ? (short ? s(c.fixed, 'fix', 'fixes') : `${s(c.fixed, 'helper')} fixed`) : '', c.product ? s(c.product, 'product bug') : '',
		c.rejected ? s(c.rejected, 'fix rejected', 'fixes rejected') : '', c.notAttempted ? `${c.notAttempted} not attempted` : '',
		c.resolved ? `${c.resolved} fixed by another fix` : '', c.flake ? s(c.flake, 'flake') : '',
	].filter(Boolean);
	const status = n.jobFailed ? 'the job broke' : n.state.wholesale ? 'smoke broke wholesale'
		: !c.fixed ? '' : unverified(n) === null ? (short ? '' : 'ready to review') : 'not verified';
	return [...found, status].filter(Boolean).join(', ') || 'all green';
}

/** What the reader is asked to do, most urgent first. */
function toDo(n: Night, where: 'summary' | 'pr' | 'slack'): string {
	const out: string[] = [];
	if (n.jobFailed) { out.push(`Find out why the job broke at "${n.jobFailed}"; nothing below is checked.`); }
	if (n.state.wholesale) { out.push('Check the app and the runner: more than a quarter of the smoke cases failed twice, which is the environment, not the helpers. No fixer ran.'); }
	if (n.state.scopeViolation) { out.push(`A fixer edited outside .claude/skills/drive-positron/ (${n.state.scopeViolation}); its change was thrown away and fixing stopped.`); }
	if (n.problems?.length) { out.push('Some report inputs could not be read; see Report problems.'); }
	if (n.state.checksRedOnMain?.length) { out.push(`check.ts was already failing on main: ${n.state.checksRedOnMain.join(', ')}.`); }
	if (n.state.outOfTime) { out.push(`The night's fixer time ran out; ${s(n.state.outOfTime, 'finding was', 'findings were')} left for the next night.`); }
	const fixes = n.findings.filter(kept);
	if (fixes.length) {
		const why = unverified(n);
		// Slack shows the review link and each finding's history on their own lines.
		if (why !== null) { out.push(`Do not merge the fixes yet: ${why}, so they are unchecked.`); }
		else if (where !== 'slack') { out.push(where === 'pr' ? 'Review and merge this PR.' : 'Review the fix: the Slack DM links the branch, and the patch is in the run artifacts.'); }
		// The PR body and summary open with the Checks changed section; Slack has only this line.
		if (where === 'slack' && fixes.some(f => f.checksChanged)) { out.push('A fix changes test/ or heal/, which judge the fixes; review that diff first.'); }
		const back = fixes.filter(f => f.fixedBefore?.length);
		if (back.length && where !== 'slack') { out.push(`${back.map(f => `"${title(f)}"`).join(', ')} came back after being fixed on earlier nights; those fixes were never merged.`); }
	}
	const product = n.findings.filter(f => f.outcome === 'product').length;
	if (product) { out.push(`Look at the ${s(product, 'product bug')} below and file an issue if there is none.`); }
	if (n.smokeRed && !n.findings.length && n.unconfirmed.length) { out.push('Smoke failed, but the rerun never reached those cases; see Unconfirmed.'); }
	return where === 'slack' ? out.join(' ') : `**To do:** ${out.join(' ') || 'nothing.'}`;
}

function status(f: Finding): string {
	if (f.rejected) { return 'fix rejected'; }
	if (f.notAttempted) { return 'not attempted'; }
	if (f.outcome === 'resolved') { return `fixed by ${f.resolvedBy}`; }
	return f.outcome === 'product' ? 'product bug' : f.outcome ?? 'no outcome';
}

/** What was seen, with a helper's JSON reply cut down to its error. */
const seen = (f: Finding) => { const m = String(f.observed).match(/"error":"((?:[^"\\]|\\.)*)"/); return m ? m[1].replace(/\\"/g, '"') : cut(f.observed, 200); };
const cut = (t: unknown, max: number) => { const x = String(t ?? ''); return x.length > max ? `${x.slice(0, max)}...` : x; };

function checked(f: Finding, n: Night): string {
	const fails = f.reproductions.filter(r => r.result === 'fail').length;
	const tries = `failed ${fails} of ${s(f.reproductions.length, 'try', 'tries')}`;
	if (f.rejected) { return `${tries}; the fix was rejected: ${cut(f.rejected, 300)}`; }
	if (f.notAttempted) { return `${tries}; not attempted: ${f.notAttempted}`; }
	if (f.outcome === 'resolved') { return `${tries}; passes after the ${f.resolvedBy} fix`; }
	if (!kept(f)) { return tries; }
	const why = unverified(n);
	if (why !== null) { return `${tries} before the fix; not verified: ${why}`; }
	const ss = f.smokeSections;
	return `${tries} before the fix; check.ts and ${ss ? `the smoke ${ss.join(', ')} ${ss.length === 1 ? 'section' : 'sections'}` : 'all of smoke'} pass with it${ss ? ' (the next nightly runs all of smoke)' : ''}`;
}

/** A finding as a heading, the plain account, and the evidence folded away. */
function block(f: Finding, n: Night, h: string): string {
	const runs = f.fixedBefore ?? [];
	return [
		`${h} ${title(f)}: ${status(f)}`, '',
		`- **What broke:** ${f.broke ?? `${f.helper}: ${seen(f)}`}`,
		...(f.cause ? [`- **Why:** ${f.cause}`] : []),
		...(f.change && f.outcome === 'fixed' ? [`- **Fix:** ${f.change}`] : []),
		`- **Checked:** ${checked(f, n)}.`,
		...(runs.length ? [`- **Seen before:** fixed on ${s(runs.length, 'earlier night')} too (${runs.map(r => `run ${r}`).join(', ')}) and came back, so those fixes never landed.`] : []),
		'', '<details><summary>Evidence</summary>', '',
		...(f.reason ? [`**Reason:** ${cut(f.reason, 1500)}`, ''] : []),
		'**Tries:**', ...f.reproductions.map(r => `- ${r.by}, ${r.result}: ${cut(r.observed, 300).replace(/\s+/g, ' ')}`), '',
		'**To reproduce:**', '', fenced(cut(f.steps.join('\n'), 500), 'sh'), '',
		...(f.commit ? [`**Commit:** ${f.commit}`, ''] : []),
		'</details>', '',
	].join('\n');
}

/** The findings' blocks, as many as fit in `budget` characters. */
function blocks(n: Night, h: string, budget: number): string[] {
	const out: string[] = [];
	let used = 0;
	for (const [i, f] of n.findings.entries()) {
		const b = block(f, n, h);
		if (used + b.length > budget) { out.push(`And ${n.findings.length - i} more, see the run summary.`, ''); break; }
		out.push(b);
		used += b.length;
	}
	return out;
}
const problemLines = (n: Night) => n.problems?.length ? ['**Report problems** (these inputs were skipped):', ...n.problems.map(p => `- ${p}`), ''] : [];

const MAX_DIFF = 20000;
const MAX_LISTED = 40;

/** A code fence longer than any backtick run in the text, so the text cannot close it. */
function fenced(text: string, info: string): string {
	const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map(r => r.length + 1)));
	return `${fence}${info}\n${text}\n${fence}`;
}

function checksSection(n: Night): string {
	const changed = n.findings.filter(f => f.checksChanged && !f.rejected);
	if (!changed.length) { return ''; }
	const diff = n.checksDiff.trim();
	const body = !diff ? '(diff unavailable)' : fenced(diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) : diff, 'diff') + (diff.length > MAX_DIFF ? '\n(truncated, see the run)' : '');
	return ['### Checks changed', '', ...changed.slice(0, MAX_LISTED).map(f => `- ${f.id}: ${(f.reason ?? '').slice(0, 300)}`), ...(changed.length > MAX_LISTED ? [`- and ${changed.length - MAX_LISTED} more, see the run summary`] : []), '', body, '', ''].join('\n');
}

export function prTitle(n: Night): string {
	const c = counts(n);
	return `drive-positron: ${c.fixed} helper fix${c.fixed === 1 ? '' : 'es'} from the nightly run`;
}

/** GitHub caps a PR body at 65536 characters; the findings get what the rest leaves, with room to spare. */
const PR_MAX = 60000;

export function prBody(n: Night, runUrl: string): string {
	const head = [checksSection(n) + '### Summary', '', `Nightly self-heal: ${headline(n)}.`, '', toDo(n, 'pr'), '', ...problemLines(n)];
	const tail = `Run: ${runUrl}`;
	return [...head, ...blocks(n, '####', PR_MAX - head.join('\n').length - tail.length), tail].join('\n');
}

const others = (n: Night) => [
	...(n.flakes.length ? [`Flakes (failed, then passed on the rerun): ${n.flakes.map(f => f.name).join(', ')}`, ''] : []),
	...(n.unconfirmed.length ? [`Unconfirmed (the rerun never reached them): ${n.unconfirmed.map(f => f.name).join(', ')}`, ''] : []),
];

export function summaryMarkdown(n: Night, runUrl: string): string {
	const cost = totalCost(n.costs);
	const unpriced = n.costs.filter(c => c.usd === null).length;
	return [
		`## drive-positron nightly: ${headline(n)}`, '', toDo(n, 'summary'), '', ...problemLines(n), checksSection(n), ...blocks(n, '###', 500000), ...others(n),
		`Cost: $${cost.total.toFixed(2)} (finder $${cost.finder.toFixed(2)}, fixer $${cost.fixer.toFixed(2)})${unpriced ? `; ${s(unpriced, 'session')} had no cost, counted as $0` : ''}. Run: ${runUrl}`,
	].join('\n');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MAX_SLACK_FINDINGS = 5;

const DOT = ' \u00b7 ';

export function slackText(n: Night, runUrl: string, link: { kind: 'compare' | 'pr' | 'patch'; url: string } | null): string {
	const pr = link?.url.match(/\/pull\/(\d+)/)?.[1];
	const go = link?.url ? `<${link.url}|${link.kind === 'pr' ? `review PR${pr ? ` #${pr}` : ''}` : link.kind === 'compare' ? 'open the PR' : 'get the patch'}>`
		: runUrl ? `<${runUrl}|see the run>` : '';
	const todo = toDo(n, 'slack');
	const fs = n.findings;
	const block = (f: Finding) => [
		`\`${esc(title(f))}\``,
		`*Broke*${DOT}${esc(f.broke ?? seen(f))}`,
		kept(f) && f.change ? `*Fix*${DOT}${esc(f.change)}` : kept(f) ? '' : `*Status*${DOT}${esc(status(f))}`,
		kept(f) && f.fixedBefore?.length ? `_Fixed on ${s(f.fixedBefore.length, 'earlier nightly', 'earlier nightlies')} too, but those fixes never merged._` : '',
	].filter(Boolean).join('\n');
	return [
		`*/drive-positron locator repairs${DOT}${esc(headline(n, true))}*`,
		...(todo ? [`*To do*${DOT}${esc(todo)}`] : []),
		...fs.slice(0, MAX_SLACK_FINDINGS).map(block),
		...(fs.length > MAX_SLACK_FINDINGS ? [`And ${fs.length - MAX_SLACK_FINDINGS} more.`] : []),
		...(go ? [`\u2192 ${go}`] : []),
	].join('\n\n');
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Reads one JSON file; returns undefined and records a problem when it cannot be read or parsed (JSON null is a value). */
function readJson(file: string, problems: string[], name: string): unknown {
	try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return undefined; }
}

const named = (x: unknown): { name: string }[] => Array.isArray(x) ? x.filter(isObject).filter(e => typeof e.name === 'string') as { name: string }[] : [];

/** Loads the night from a heal dir; every read is guarded so a bad file is skipped and named. */
export function loadNight(dir: string, smokeRed: boolean, jobFailed: string | null): Night {
	const problems: string[] = [];
	const list = (file: string): { name: string }[] => {
		if (!existsSync(join(dir, file))) { return []; }
		const v = readJson(join(dir, file), problems, file);
		if (v === undefined) { return []; }
		if (!Array.isArray(v)) { problems.push(`${file}: not a list`); return []; }
		return named(v);
	};
	const findings: Finding[] = [];
	const fdir = join(dir, 'findings');
	for (const f of existsSync(fdir) ? readdirSync(fdir).filter(x => x.endsWith('.json')).sort() : []) {
		const v = readJson(join(fdir, f), problems, `findings/${f}`);
		if (v === undefined) { continue; }
		if (!isObject(v) || typeof v.id !== 'string' || !Array.isArray(v.reproductions) || !v.reproductions.every(isObject)) { problems.push(`findings/${f}: not a finding`); continue; }
		findings.push(v as unknown as Finding);
	}
	let state: State = {};
	if (existsSync(join(dir, 'state.json'))) {
		const v = readJson(join(dir, 'state.json'), problems, 'state.json');
		if (isObject(v)) { state = v as State; } else if (v !== undefined) { problems.push('state.json: not an object'); }
	}
	const costs: Night['costs'] = [];
	const cdir = join(dir, 'cost');
	for (const f of existsSync(cdir) ? readdirSync(cdir).filter(x => x.endsWith('.json')).sort() : []) {
		const v = readJson(join(cdir, f), problems, `cost/${f}`);
		const total = isObject(v) && isObject(v.cost) ? v.cost.total_cost_usd : null;
		if (v !== undefined && !isObject(v)) { problems.push(`cost/${f}: not an object`); }
		costs.push({ label: f.replace(/\.json$/, ''), usd: typeof total === 'number' && Number.isFinite(total) ? total : null });
	}
	const diff = join(dir, 'checks.diff');
	return { findings, flakes: list('flakes.json'), unconfirmed: list('unconfirmed.json'), state, smokeRed, jobFailed, costs, checksDiff: existsSync(diff) ? readFileSync(diff, 'utf8') : '', problems };
}

const VERBS = ['summary', 'title', 'body', 'slack', 'notify?', 'notify'];
const KINDS = ['compare', 'pr', 'patch'];

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

function main(): number {
	const all = process.argv.slice(2).filter(a => a !== '--smoke-red');
	const smokeRed = process.argv.slice(2).includes('--smoke-red');
	// The verb sits among the flags, so find the one that is not a flag's value.
	const FLAGS = ['--dir', '--run-url', '--job-failed', '--link-kind', '--link'];
	const at = all.findIndex((a, i) => VERBS.includes(a) && !FLAGS.includes(all[i - 1]));
	if (at < 0) { console.log(`report: name one of ${VERBS.join(', ')}`); return 2; }
	const verb = all[at];
	const own = [...all.slice(0, at), ...all.slice(at + 1)];
	const bad = unknownArg(own, FLAGS);
	if (bad !== null) { console.log(`report: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const flag = (name: string): string | null => {
		const v = flagValue(own, name);
		if (v instanceof Error) { console.log(`report: ${v.message}`); process.exit(2); }
		return v;
	};
	const dir = flag('--dir') ?? '/tmp/heal';
	const runUrl = flag('--run-url') ?? '';
	const kind = flag('--link-kind');
	const url = flag('--link');
	if ((kind === null) !== (url === null)) { console.log('report: --link-kind and --link go together'); return 2; }
	if (kind !== null && !KINDS.includes(kind)) { console.log(`report: --link-kind must be one of ${KINDS.join(', ')}`); return 2; }
	const n = loadNight(dir, smokeRed, flag('--job-failed') || null);
	const link = kind !== null && url !== null ? { kind: kind as 'compare' | 'pr' | 'patch', url } : null;
	const out = verb === 'title' ? prTitle(n) : verb === 'body' ? prBody(n, runUrl) : verb === 'slack' ? slackText(n, runUrl, link)
		: verb === 'summary' ? summaryMarkdown(n, runUrl) : String(shouldNotify(n));
	process.stdout.write(`${out}\n`);
	return 0;
}

if (isMain()) {
	try { process.exit(main()); } catch (e) { console.log(`report: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
}
