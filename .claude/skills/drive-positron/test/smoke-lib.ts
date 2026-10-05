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
export interface CaseResult { name: string; status: Status; helper: string; args: string[]; problem: string; ms: number }
export interface SmokeResults { startedAt: string; until: string | null; quick: boolean; launch: 'PASS' | 'FAIL'; launchProblem: string; cases: CaseResult[] }

/** The cases a run goes through, in order: all, or the quick ones, up to and including --until. */
export function selectCases<T extends { name: string; quick?: boolean }>(cases: T[], opts: { quick: boolean; until: string | null }): T[] {
	const pool = opts.quick ? cases.filter(c => c.quick) : cases;
	if (opts.until === null) { return pool; }
	const at = pool.findIndex(c => c.name === opts.until);
	if (at < 0) {
		throw new Error(cases.some(c => c.name === opts.until) ? `"${opts.until}" is not in the --quick run` : `no case named "${opts.until}"`);
	}
	return pool.slice(0, at + 1);
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
