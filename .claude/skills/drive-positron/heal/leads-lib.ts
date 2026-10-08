/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Leads for the finder: the helper failures in exploratory runs' actions.log,
// grouped by helper and error, with what the agent did next. A failure the
// agent got past by retrying the same command or acting by hand is the
// strongest sign of a helper gap: the app could do it, the helper could not.

/**
 * How the agent got past a failure: the same helper command worked within a
 * few lines (often with other arguments), it acted by hand (click:, raw:, or a
 * note saying so), or neither.
 */
export type Next = 'retried' | 'by hand' | 'unresolved';

export interface Failure { helper: string; word: string; error: string; key: string; line: string; next: Next; after: string[] }

export interface Lead {
	key: string; helper: string; count: number; runs: string[];
	next: Record<Next, number>;
	examples: { run: string; line: string; after: string[] }[];
}

interface Entry { name: string; session: string; failed: boolean; text: string; line: string }

const LINE = /^\S+Z (?<name>[\w.-]+)(?: -s=(?<session>[^:]*))?: (?<failed>FAILED )?(?<text>.*)$/;
/** How many lines after a failure count as what the agent did about it. */
const WINDOW = 6;

function parse(line: string): Entry | null {
	const m = LINE.exec(line);
	return m?.groups ? { name: m.groups.name, session: m.groups.session ?? '', failed: !!m.groups.failed, text: m.groups.text, line } : null;
}

/** Splits "click radio 'A: B' --in dialog: no visible radio" at the first ": " outside quotes. */
export function splitCommand(text: string): { command: string; error: string } {
	let quote = '';
	for (let i = 0; i < text.length - 1; i++) {
		const c = text[i];
		if (quote) { if (c === quote) { quote = ''; } continue; }
		if (c === '\'' || c === '"') { quote = c; continue; }
		if (c === ':' && text[i + 1] === ' ') { return { command: text.slice(0, i), error: text.slice(i + 2) }; }
	}
	return { command: '', error: text };
}

/** The error without its context ("; a modal dialog is open: ..."), quoted names or numbers, so one gap reads the same in every run. */
export function normalizeError(error: string): string {
	return error.split('; ')[0].replace(/"[^"]*"|'[^']*'/g, '"_"').replace(/\d+/g, 'N').trim();
}

/** The failures in one actions.log, without the ones that follow from the failure before. */
export function failures(log: string): Failure[] {
	const entries = log.split('\n').map(parse).filter((e): e is Entry => e !== null);
	const out: Failure[] = [];
	entries.forEach((e, i) => {
		if (!e.failed || !e.name.endsWith('.sh')) { return; }
		// A failure right after another one, with nothing done in between but notes, follows from it.
		const prev = entries.slice(0, i).reverse().find(p => p.name !== 'note');
		if (prev?.failed && prev.session === e.session) { return; }
		const { command, error } = splitCommand(e.text);
		// The command word: ui.sh's click, window.sh's open-folder, notifications.sh's --click.
		const first = command.split(' ')[0].replace(/^--/, '');
		const word = /^[a-z][\w-]*$/.test(first) ? first : '';
		const after = entries.slice(i + 1, i + 1 + WINDOW);
		let next: Next = 'unresolved';
		for (const a of after) {
			if (a.name === e.name && a.session === e.session) {
				// A success logs the word as it did it: "open-folder" as "open folder", "--click" as "clicked".
				if (!a.failed && (!word || a.text.startsWith(word) || a.text.startsWith(word.replace(/-/g, ' ')))) { next = 'retried'; break; }
				continue;
			}
			if (a.name === 'click' || a.name === 'raw' || (a.name === 'note' && /^(click|press|type)\b/i.test(a.text))) { next = 'by hand'; break; }
		}
		const norm = normalizeError(error);
		out.push({ helper: e.name, word, error: norm, key: `${e.name}${word ? ' ' + word : ''}: ${norm}`, line: e.line, next, after: after.slice(0, 3).map(a => a.line) });
	});
	return out;
}

/** Groups failures across runs, most telling first: seen in more runs, then more often got past. */
export function groupLeads(byRun: { run: string; failures: Failure[] }[]): Lead[] {
	const groups = new Map<string, { run: string; f: Failure }[]>();
	for (const { run, failures: fs } of byRun) {
		for (const f of fs) { groups.set(f.key, [...groups.get(f.key) ?? [], { run, f }]); }
	}
	const leads = [...groups.entries()].map(([key, all]): Lead => {
		const next: Record<Next, number> = { 'retried': 0, 'by hand': 0, 'unresolved': 0 };
		all.forEach(x => next[x.f.next]++);
		// The examples worth reading are the ones the agent got past, from different runs.
		const examples: Lead['examples'] = [];
		for (const x of [...all].sort((a, b) => Number(a.f.next === 'unresolved') - Number(b.f.next === 'unresolved'))) {
			if (examples.length < 2 && !examples.some(e => e.run === x.run)) { examples.push({ run: x.run, line: x.f.line, after: x.f.after }); }
		}
		return { key, helper: all[0].f.helper, count: all.length, runs: [...new Set(all.map(x => x.run))], next, examples };
	});
	const gotPast = (l: Lead) => l.next['retried'] + l.next['by hand'];
	return leads.sort((a, b) => b.runs.length - a.runs.length || gotPast(b) - gotPast(a) || b.count - a.count);
}

/** The leads as the finder's brief lists them. */
export function formatLeads(leads: Lead[], max: number): string {
	return leads.slice(0, max).map((l, i) => {
		const got = (['retried', 'by hand', 'unresolved'] as Next[]).filter(n => l.next[n]).map(n => `${n} ${l.next[n]}`).join(', ');
		const ex = l.examples.map(x => [`    ${x.run}`, `      ${x.line}`, ...x.after.map(a => `      ${a}`)].join('\n')).join('\n');
		return `${i + 1}. ${l.key}\n   ${l.count} time(s) in ${l.runs.length} run(s); then: ${got}\n${ex}`;
	}).join('\n\n');
}
