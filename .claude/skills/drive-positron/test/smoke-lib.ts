/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for smoke.ts, kept apart so they can be tested without an app.

import { readFileSync } from 'fs';

/** start-session --name words for a runtime label: its version, then the env name in parentheses. */
export function nameWords(label: string): string | null {
	const version = label.match(/\b\d+\.\d+\.\d+\b/)?.[0];
	if (!version) { return null; }
	const env = label.match(/\((?:[^:)]*:\s*)?([^)]+)\)\s*$/)?.[1]?.trim();
	return env ? `${version} ${env}` : version;
}

/** The first runtime picker row of a language, as quickpick-enum.sh lists them. */
export function firstRow(rows: { kind: string; label: string }[], language: 'r' | 'python'): string | null {
	const lead = language === 'r' ? /^R \d/ : /^Python \d/;
	return rows.find(r => r.kind === 'item' && lead.test(r.label))?.label ?? null;
}

export type Status = 'PASS' | 'FAIL' | 'KNOWN';
/** `group` is the smoke.ts section the case is in; a setup step's is its group's too. */
export interface CaseResult { name: string; status: Status; helper: string; args: string[]; problem: string; ms: number; group?: string }
export interface SmokeResults { startedAt: string; until: string | null; quick: boolean; launch: 'PASS' | 'FAIL'; launchProblem: string; cases: CaseResult[] }

/** A section of smoke.ts: its cases start at `first`, and `setup` builds what they need from earlier sections. */
export interface Group<T> { id: string; first: string; setup: T[] }

export interface Selection { quick: boolean; until: string | null; group?: string | null; fromStart?: boolean }

/** Each case's group id, by index: the last group whose first case is at or before it. */
export function groupIds<T extends { name: string }>(cases: T[], groups: Group<T>[]): string[] {
	const starts = groups.map(g => {
		const at = cases.findIndex(c => c.name === g.first);
		if (at < 0) { throw new Error(`group "${g.id}" starts at "${g.first}", which no case is named`); }
		return { id: g.id, at };
	});
	return cases.map((_, i) => starts.filter(s => s.at <= i).at(-1)?.id ?? '');
}

/**
 * The cases a run goes through, in order. The full run is every case (or the
 * quick ones) with no setups. --until NAME is NAME's group: its setup, then
 * its cases through NAME; with --from-start, every case through NAME.
 * --group ID is that group's setup and all its cases.
 */
export function selectCases<T extends { name: string; quick?: boolean }>(cases: T[], opts: Selection, groups: Group<T>[] = []): T[] {
	const ids = groupIds(cases, groups);
	const keep = (c: T) => !opts.quick || c.quick;
	const { until, group = null, fromStart = false } = opts;
	if (group !== null && until !== null) { throw new Error('--group and --until do not go together'); }
	if (fromStart && until === null) { throw new Error('--from-start needs --until'); }
	if (group !== null) {
		const g = groups.find(x => x.id === group);
		if (!g) { throw new Error(`no group "${group}"; groups: ${groups.map(x => x.id).join(', ')}`); }
		return [...g.setup, ...cases.filter((c, i) => ids[i] === group && keep(c))];
	}
	if (until === null) { return cases.filter(keep); }
	const at = cases.findIndex(c => c.name === until);
	if (at < 0) { throw new Error(`no case named "${until}"`); }
	if (!keep(cases[at])) { throw new Error(`"${until}" is not in the --quick run`); }
	if (fromStart || !groups.length) { return cases.slice(0, at + 1).filter(keep); }
	const g = groups.find(x => x.id === ids[at])!;
	return [...g.setup, ...cases.slice(0, at + 1).filter((c, i) => ids[i] === g.id && keep(c))];
}

export function readResults(file: string): SmokeResults {
	return JSON.parse(readFileSync(file, 'utf8')) as SmokeResults;
}

/** The value after a flag: null if the flag is absent, an Error if it has no value. */
export function flagValue(argv: string[], name: string): string | null | Error {
	const i = argv.indexOf(name);
	if (i < 0) { return null; }
	const v = argv[i + 1];
	return v === undefined || v.startsWith('--') ? new Error(`${name} needs a value`) : v;
}

/** The first argument that is not a known flag followed by its value, or null. A leading subcommand is skipped. */
export function unknownArg(argv: string[], flags: string[], subcommands: string[] = []): string | null {
	for (let i = 0; i < argv.length; i++) {
		if (i === 0 && subcommands.includes(argv[i])) { continue; }
		if (!flags.includes(argv[i])) { return argv[i]; }
		i++;
	}
	return null;
}

/** The record for a case that threw instead of returning a result. */
export function threwResult(name: string, args: string[], err: unknown, ms: number): CaseResult {
	return { name, status: 'FAIL', helper: args[0] ?? '', args: args.slice(1), problem: `threw: ${err instanceof Error ? err.message : String(err)}`, ms };
}
