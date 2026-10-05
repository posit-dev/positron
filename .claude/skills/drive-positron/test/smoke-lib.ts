/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for smoke.ts, kept apart so they can be tested without an app.

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
