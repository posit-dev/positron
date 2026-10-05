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
	costs: { label: string; usd: number | null }[]; smokeDiff: string;
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

/** What the gate (check.ts plus a full smoke run over the fixes) told us; only 'passed' may be reported as safe. */
function gateText(n: Night): string | null {
	if (n.jobFailed) { return `did not finish (the job broke at "${n.jobFailed}"); the fixes are unchecked`; }
	if (n.state.wholesale) { return null; }
	switch (n.state.gate) {
		case 'pass': return 'passed';
		case 'fail': return 'failed; do not merge';
		case 'none': return 'not run (no fix was accepted)';
		default: return n.findings.length ? 'unknown (the fix loop did not finish); the fixes are unchecked' : null;
	}
}
const gateLine = (n: Night) => { const g = gateText(n); return g === null ? '' : `Gate: ${g}.`; };

const countLine = (n: Night) => {
	const c = counts(n);
	return [`${c.fixed} helper fix${c.fixed === 1 ? '' : 'es'}`, `${c.product} product`, `${c.flake} flake${c.flake === 1 ? '' : 's'}`, `${c.resolved} resolved by another fix`, `${c.rejected} fix${c.rejected === 1 ? '' : 'es'} rejected`, `${c.notAttempted} not attempted`].join(', ');
};
const label = (f: Finding) => f.rejected ? `fix rejected: ${f.rejected}` : f.notAttempted ? `not attempted: ${f.notAttempted}` : f.outcome === 'resolved' ? `resolved by ${f.resolvedBy}` : f.outcome ?? 'no outcome';
const line = (f: Finding) => `- **${f.id}** (${f.helper}, ${label(f)}): ${String(f.observed).slice(0, 200)}. Runs: ${f.reproductions.map(r => `${r.by} ${r.result}: ${String(r.observed).slice(0, 120)}`).join(' / ')}${f.reason ? `. Reason: ${f.reason.slice(0, 300)}` : ''}`;
const problemLines = (n: Night) => n.problems?.length ? ['**Report problems** (these inputs were skipped):', ...n.problems.map(p => `- ${p}`), ''] : [];

function smokeSection(n: Night): string {
	const changed = n.findings.filter(f => f.smokeChecksChanged && !f.rejected);
	if (!changed.length) { return ''; }
	return ['### Smoke checks changed', '', ...changed.map(f => `- ${f.id}: ${f.reason ?? ''}`), '', '```diff', n.smokeDiff.trim(), '```', '', ''].join('\n');
}

export function prTitle(n: Night): string {
	const c = counts(n);
	return `drive-positron: ${c.fixed} helper fix${c.fixed === 1 ? '' : 'es'} from the nightly run`;
}

export function prBody(n: Night, runUrl: string): string {
	return [smokeSection(n) + '### Summary', '', `Nightly self-heal: ${countLine(n)}. ${gateLine(n)}`.trim(), '', ...problemLines(n), ...n.findings.map(line), '', `Run: ${runUrl}`].join('\n');
}

export function summaryMarkdown(n: Night, runUrl: string): string {
	const out = ['## drive-positron: nightly self-heal', ''];
	if (n.jobFailed) { out.push(`**The job broke at "${n.jobFailed}".** The findings below may be incomplete and no fix is verified.`, ''); }
	if (n.state.wholesale) { out.push('**Smoke broke wholesale** (more than a quarter of the cases failed twice): the environment, not the helpers. No fixer ran.', ''); }
	if (n.state.scopeViolation) { out.push(`**A fixer edited outside .claude/skills/drive-positron/** (${n.state.scopeViolation}); its changes were discarded and fixing stopped.`, ''); }
	out.push(...problemLines(n));
	out.push(smokeSection(n) + countLine(n), '', ...[gateLine(n)].filter(Boolean), ...n.findings.map(line));
	if (n.flakes.length) { out.push('', `Flakes (failed, then passed on the rerun): ${n.flakes.map(f => f.name).join(', ')}`); }
	if (n.unconfirmed.length) { out.push('', `Unconfirmed (the rerun never reached them): ${n.unconfirmed.map(f => f.name).join(', ')}`); }
	const cost = totalCost(n.costs);
	const unpriced = n.costs.filter(c => c.usd === null).length;
	out.push('', `Cost: $${cost.total.toFixed(2)} (finder $${cost.finder.toFixed(2)}, fixer $${cost.fixer.toFixed(2)})${unpriced ? `; ${unpriced} session${unpriced === 1 ? '' : 's'} had no cost, counted as $0` : ''}. Run: ${runUrl}`);
	return out.join('\n');
}

export function slackText(n: Night, runUrl: string, link: { kind: 'compare' | 'pr' | 'patch'; url: string } | null): string {
	const head = n.jobFailed ? `drive-positron nightly broke at "${n.jobFailed}"` : n.state.wholesale ? 'drive-positron smoke broke wholesale' : 'drive-positron nightly';
	const go = link ? ` | <${link.url}|${link.kind === 'compare' ? 'open the PR' : link.kind === 'pr' ? 'the PR' : 'the patch'}>` : '';
	const gate = gateLine(n);
	const bad = n.problems?.length ? ` ${n.problems.length} report input${n.problems.length === 1 ? '' : 's'} unreadable.` : '';
	return `*${head}*: ${countLine(n)}.${gate ? ` ${gate}` : ''}${bad} Cost $${totalCost(n.costs).total.toFixed(2)}. <${runUrl}|run>${go}`;
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
	const diff = join(dir, 'smoke.diff');
	return { findings, flakes: list('flakes.json'), unconfirmed: list('unconfirmed.json'), state, smokeRed, jobFailed, costs, smokeDiff: existsSync(diff) ? readFileSync(diff, 'utf8') : '', problems };
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
