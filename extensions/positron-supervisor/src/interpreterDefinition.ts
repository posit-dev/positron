/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as positron from 'positron';
import * as vscode from 'vscode';
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
 * point. Variables the script unsets are not reported, since the supervisor
 * can only set variables. Startup scripts need a POSIX shell, so they are
 * skipped on Windows.
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

/** The parts of a session that decide whether it drives the terminal environment. */
interface TerminalEnvironmentSession {
	readonly metadata: Pick<positron.RuntimeSessionMetadata, 'sessionMode'>;
}

/** The slice of a terminal environment variable collection used here. */
export interface TerminalEnvironmentCollection extends Pick<vscode.EnvironmentVariableCollection, 'get' | 'replace' | 'prepend' | 'append' | 'delete'> {
	forEach(callback: (variable: string) => void): void;
}

/**
 * Sets the terminal environment variables for the foreground console session:
 * the variables its interpreter definition sets, or none if it has none.
 */
export class DefinitionTerminalEnvironment<S extends TerminalEnvironmentSession> {
	/**
	 * Counts updates, so that an update that finishes after a newer one
	 * started is dropped.
	 */
	private _updates = 0;

	/** The names of the variables set here. */
	private _names = new Set<string>();

	/**
	 * @param _collection The terminal environment. It is shared with other
	 *   variables, and persists across windows.
	 * @param preserved The names of the other variables in the collection.
	 *   Everything else is removed, since variables set by a previous window
	 *   may no longer apply.
	 * @param _getSession Gets a session by ID.
	 * @param _getDefinitionEnv Gets the variables a console session's
	 *   interpreter definition sets, or none if it has no definition.
	 * @param _processEnv The environment terminals start from.
	 */
	constructor(
		private readonly _collection: TerminalEnvironmentCollection,
		preserved: readonly string[],
		private readonly _getSession: (sessionId: string) => Thenable<S | undefined>,
		private readonly _getDefinitionEnv: (session: S) => Promise<Record<string, string>>,
		private readonly _processEnv: NodeJS.ProcessEnv = process.env,
	) {
		const stale: string[] = [];
		_collection.forEach(name => {
			if (!preserved.includes(name)) {
				stale.push(name);
			}
		});
		for (const name of stale) {
			_collection.delete(name);
		}
	}

	/**
	 * Update the variables for a new foreground session.
	 *
	 * @param sessionId The ID of the foreground session, if any.
	 */
	async update(sessionId: string | undefined): Promise<void> {
		// Number the update before any await, so it reflects the order the
		// foreground changes happened in.
		const update = ++this._updates;
		const session = sessionId ? await this._getSession(sessionId) : undefined;
		// Only consoles drive the terminal environment; a notebook coming to
		// the foreground leaves the console's variables in place.
		if (session && session.metadata.sessionMode !== positron.LanguageRuntimeSessionMode.Console) {
			return;
		}
		const env = session ? await this._getDefinitionEnv(session) : {};
		if (update !== this._updates) {
			return;
		}

		// Remove only the variables set here; the collection is shared.
		for (const name of this._names) {
			if (env[name] === undefined) {
				this._collection.delete(name);
			}
		}
		this._names = new Set(Object.keys(env));
		const types = {
			replace: vscode.EnvironmentVariableMutatorType.Replace,
			prepend: vscode.EnvironmentVariableMutatorType.Prepend,
			append: vscode.EnvironmentVariableMutatorType.Append,
		};
		// Terminals only: kernels and other spawned processes take
		// ProcessCreation contributions, and must not inherit another
		// session's definition (as with R's module environment).
		const options = { applyAtProcessCreation: false, applyAtShellIntegration: true };
		for (const [name, value] of Object.entries(env)) {
			const mutation = getTerminalMutation(value, this._processEnv[name]);
			// Skip variables that are already set, to avoid needlessly marking
			// open terminals as stale.
			const existing = this._collection.get(name);
			if (existing?.type === types[mutation.type] && existing.value === mutation.value) {
				continue;
			}
			this._collection[mutation.type](name, mutation.value, options);
		}
	}
}
