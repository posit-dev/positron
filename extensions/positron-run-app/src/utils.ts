/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* Utilities copied from ../../../src/vs/base/common/async.ts */

export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;
	let promiseReject: ((reason?: unknown) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		try {
			onTimeout?.();
			promiseResolve?.(undefined);
		} catch (error) {
			promiseReject?.(error);
		}
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>((resolve, reject) => {
			promiseResolve = resolve;
			promiseReject = reject;
		})
	]);
}

export interface ITask<T> {
	(): T;
}

export class SequencerByKey<TKey> {

	private promiseMap = new Map<TKey, Promise<unknown>>();

	has(key: TKey): boolean {
		return this.promiseMap.has(key);
	}

	queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			// Swallow unhandled errors from the previous task so the current one still runs.
			.catch((error) => { console.warn(`[positron-run-app] Previous queued task for key '${key}' failed:`, error); })
			.then(promiseTask)
			.finally(() => {
				if (this.promiseMap.get(key) === newPromise) {
					this.promiseMap.delete(key);
				}
			});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}
}

/* Utilities copied from ../../../src/vs/base/common/strings.ts */

const CSI_SEQUENCE = /(?:(?:\x1b\[|\x9B)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~])|(:?\x1b\].*?\x07)/g;

export function removeAnsiEscapeCodes(str: string): string {
	if (str) {
		str = str.replace(CSI_SEQUENCE, '');
	}

	return str;
}

/*
 * Shell-appropriate command-line quoting. The per-shell `quote` functions are
 * adapted from `prepareCommand` in
 * ../../../src/vs/workbench/contrib/debug/node/terminals.ts (core is not
 * importable from an extension). Unlike the original, this only quotes a
 * command and its arguments; the working directory and environment are handled
 * separately when the terminal is created.
 */

const enum ShellType { cmd, powershell, bash }

function detectShellType(shell: string | undefined): ShellType {
	const s = (shell ?? '').trim().toLowerCase();
	if (s.indexOf('powershell') >= 0 || s.indexOf('pwsh') >= 0) {
		return ShellType.powershell;
	} else if (s.indexOf('cmd.exe') >= 0) {
		return ShellType.cmd;
	} else if (s.indexOf('bash') >= 0) {
		return ShellType.bash;
	} else if (process.platform === 'win32') {
		return ShellType.cmd; // pick a good default for Windows
	} else {
		return ShellType.bash; // pick a good default for anything else
	}
}

/**
 * Build a shell-escaped command line from an executable and its arguments,
 * quoting each value for the given shell.
 *
 * @param shell The shell the command line will run in (e.g. `vscode.env.shell`).
 * @param command The executable to run.
 * @param args The arguments to pass to `command`.
 * @returns The escaped command line string.
 */
export function buildCommandLine(shell: string | undefined, command: string, args: string[] = []): string {
	const parts = [command, ...args];

	switch (detectShellType(shell)) {
		case ShellType.powershell: {
			const quote = (s: string) => {
				s = s.replace(/\'/g, '\'\'');
				if (s.length > 0 && s.charAt(s.length - 1) === '\\') {
					return `'${s}\\'`;
				}
				return `'${s}'`;
			};
			// In PowerShell a quoted executable must be invoked with the call
			// operator `&`.
			const cmd = quote(parts[0]);
			const rest = parts.slice(1).map(quote);
			return [cmd[0] === '\'' ? `& ${cmd}` : cmd, ...rest].join(' ');
		}
		case ShellType.cmd: {
			const quote = (s: string) => {
				s = s.replace(/\"/g, '""');
				s = s.replace(/([><!^&|])/g, '^$1');
				return (' "'.split('').some(char => s.includes(char)) || s.length === 0) ? `"${s}"` : s;
			};
			return parts.map(quote).join(' ');
		}
		case ShellType.bash: {
			const quote = (s: string) => {
				s = s.replace(/(["'\\\$!><#()\[\]*&^| ;{}?`])/g, '\\$1');
				return s.length === 0 ? `""` : s;
			};
			return parts.map(quote).join(' ');
		}
	}
}
