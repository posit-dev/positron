/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * An entry in the `interpreters.definitions` setting. Mirrors
 * IInterpreterDefinition in core (languageRuntime/common/interpreterDefinitions.ts).
 */
export interface InterpreterDefinition {
	language: string;
	path: string;
	label: string;
	env?: Record<string, string>;
	startupScript?: string;
}

/**
 * Find the definition a runtime variant was created from. Setting values are
 * not type-checked when read, so malformed values are ignored rather than
 * throwing.
 */
export function findInterpreterDefinition(definitions: unknown, languageId: string, label: string, runtimePath: string): InterpreterDefinition | undefined {
	if (!Array.isArray(definitions)) {
		return undefined;
	}
	return definitions.find((definition): definition is InterpreterDefinition => {
		if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
			return false;
		}
		const candidate = definition as Record<string, unknown>;
		return candidate.language === languageId &&
			typeof candidate.path === 'string' &&
			candidate.path === runtimePath &&
			candidate.label === label &&
			(candidate.env === undefined || isStringRecord(candidate.env)) &&
			(candidate.startupScript === undefined || typeof candidate.startupScript === 'string');
	});
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
}

/**
 * Variables a shell sets for itself, which are not part of what a startup
 * script configures.
 */
const SHELL_VARIABLES = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'ELECTRON_RUN_AS_NODE']);

/**
 * Get the environment variables an interpreter definition sets: its `env`,
 * plus every variable its startup script sets or changes. The script is
 * sourced once in a POSIX shell, starting from `baseEnv` with the definition's
 * `env` applied, and the resulting environment is compared to that starting
 * point. Startup scripts need a POSIX shell, so they are skipped on Windows.
 *
 * @param definition The interpreter definition.
 * @param baseEnv The environment the interpreter would otherwise start with.
 * @param platform The current platform.
 * @returns The variables to set, by name.
 */
export async function resolveDefinitionEnv(definition: InterpreterDefinition, baseEnv: Record<string, string>, platform: NodeJS.Platform): Promise<Record<string, string>> {
	const env = { ...definition.env };
	if (!definition.startupScript || platform === 'win32') {
		return env;
	}
	const before = { ...baseEnv, ...env };
	const scriptPath = definition.startupScript.replace(/^~(?=$|\/)/, os.homedir());
	// Print the environment with the extension host's own runtime (Electron
	// run as Node, or Node on a server) so the output is unambiguous JSON.
	// Clear the positional parameters so the sourced script doesn't see them.
	let stdout: string;
	try {
		({ stdout } = await execFileAsync('/bin/sh', [
			'-c',
			'script="$1"; node="$2"; code="$3"; set --; . "$script" >&2 && exec "$node" -e "$code"',
			'sh', scriptPath, process.execPath, 'process.stdout.write(JSON.stringify(process.env))',
		], {
			env: { ...before, ELECTRON_RUN_AS_NODE: '1' },
			timeout: 30_000,
			maxBuffer: 10 * 1024 * 1024,
		}));
	} catch (err) {
		// Report the script's own output rather than the wrapper command.
		const { stderr, code, killed } = err as { stderr?: string; code?: number; killed?: boolean };
		throw new Error(stderr?.trim() || (killed ? 'timed out after 30 seconds' : `exited with code ${code}`));
	}
	const after: Record<string, string> = JSON.parse(stdout);
	for (const [name, value] of Object.entries(after)) {
		if (before[name] !== value && !SHELL_VARIABLES.has(name)) {
			env[name] = value;
		}
	}
	return env;
}

/**
 * How to set a variable in a terminal so that it ends up with `value`. When the
 * value only adds to the start or end of the variable's current value (as a
 * startup script does to PATH), add just that part, so other extensions'
 * changes to the same variable are kept.
 *
 * @param value The value the variable should have.
 * @param current The variable's current value, if any.
 */
export function getTerminalMutation(value: string, current: string | undefined): { type: 'replace' | 'prepend' | 'append'; value: string } {
	if (current && value !== current && value.endsWith(current)) {
		return { type: 'prepend', value: value.slice(0, -current.length) };
	}
	if (current && value !== current && value.startsWith(current)) {
		return { type: 'append', value: value.slice(current.length) };
	}
	return { type: 'replace', value };
}
