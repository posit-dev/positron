/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CapturedEnvironmentVariable } from './types.js';

/**
 * Environment variables that legitimately vary between two invocations of the
 * same shell (and so would otherwise show up as spurious module contributions).
 * These are never propagated to terminals.
 */
export const VOLATILE_ENV_VARS = new Set<string>([
	'_',
	'SHLVL',
	'PWD',
	'OLDPWD',
]);

/**
 * Parse the null-delimited output of `env -0` into a map of environment
 * variables. Null delimiting (rather than newlines) is used so that values
 * containing newlines are handled correctly.
 *
 * @param output The raw stdout from `env -0`.
 * @returns A map of variable name to value.
 */
export function parseNullDelimitedEnv(output: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const entry of output.split('\0')) {
		if (!entry) {
			continue;
		}
		const eq = entry.indexOf('=');
		if (eq === -1) {
			continue;
		}
		result[entry.slice(0, eq)] = entry.slice(eq + 1);
	}
	return result;
}

/**
 * Diff a baseline environment against one with modules loaded, and classify each
 * change as an action suitable for a terminal's `EnvironmentVariableCollection`:
 *
 * - A variable whose loaded value is the baseline value with a prefix/suffix
 *   added (e.g. `PATH`) becomes a `prepend`/`append` of just that delta, so the
 *   terminal's own value and other extensions' contributions are preserved.
 * - Any other changed or newly-added variable becomes a `replace`.
 *
 * Variables that are unchanged, or that vary spuriously between invocations
 * (see {@link VOLATILE_ENV_VARS}), are omitted.
 *
 * @param baseline The environment without modules loaded.
 * @param loaded The environment with the modules loaded.
 * @returns The captured environment variable actions.
 */
export function diffCapturedEnvironment(
	baseline: Record<string, string>,
	loaded: Record<string, string>
): CapturedEnvironmentVariable[] {
	const captured: CapturedEnvironmentVariable[] = [];
	for (const [name, value] of Object.entries(loaded)) {
		if (VOLATILE_ENV_VARS.has(name)) {
			continue;
		}
		const base = baseline[name];
		if (base === value) {
			// Unchanged by loading the modules.
			continue;
		}
		if (base === undefined || base === '') {
			// Newly introduced by the modules.
			captured.push({ name, value, action: 'replace' });
		} else if (value.endsWith(base)) {
			// Modules prepended to the existing value; keep only the delta.
			captured.push({ name, value: value.slice(0, value.length - base.length), action: 'prepend' });
		} else if (value.startsWith(base)) {
			// Modules appended to the existing value; keep only the delta.
			captured.push({ name, value: value.slice(base.length), action: 'append' });
		} else {
			// Changed in a way we cannot express as a prepend/append.
			captured.push({ name, value, action: 'replace' });
		}
	}
	return captured;
}
