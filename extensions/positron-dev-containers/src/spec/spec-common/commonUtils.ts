/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Writable, Readable } from 'stream';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as ptyType from 'node-pty';
import { StringDecoder } from 'string_decoder';
import { createRequire } from 'module';

import { toErrorText } from './errors';
import { Disposable, Event, NodeEventEmitter } from '../spec-utils/event';
import { isLocalFile } from '../spec-utils/pfs';
import { escapeRegExCharacters } from '../spec-utils/strings';
import { Log, nullLog } from '../spec-utils/log';
import { ShellServer } from './shellServer';

export { CLIHost, getCLIHost } from './cliHost';

export interface Exec {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	exit: Promise<{ code: number | null; signal: string | null }>;
	terminate(): Promise<void>;
}

export interface ExecParameters {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	cmd: string;
	args?: string[];
	stdio?: [cp.StdioNull | cp.StdioPipe, cp.StdioNull | cp.StdioPipe, cp.StdioNull | cp.StdioPipe];
	output: Log;
}

export interface ExecFunction {
	(params: ExecParameters): Promise<Exec>;
}

export type GoOS = { [OS in NodeJS.Platform]: OS extends 'win32' ? 'windows' : OS; }[NodeJS.Platform];
export type GoARCH = { [ARCH in NodeJS.Architecture]: ARCH extends 'x64' ? 'amd64' : ARCH; }[NodeJS.Architecture];

export interface PlatformInfo {
	os: GoOS;
	arch: GoARCH;
	variant?: string;
}

export interface PtyExec {
	onData: Event<string>;
	write?(data: string): void;
	resize(cols: number, rows: number): void;
	exit: Promise<{ code: number | undefined; signal: number | undefined }>;
	terminate(): Promise<void>;
}

export interface PtyExecParameters {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	cmd: string;
	args?: string[];
	cols?: number;
	rows?: number;
	output: Log;
}

export interface PtyExecFunction {
	(params: PtyExecParameters): Promise<PtyExec>;
}

export function equalPaths(platform: NodeJS.Platform, a: string, b: string) {
	if (platform === 'linux') {
		return a === b;
	}
	return a.toLowerCase() === b.toLowerCase();
}

export async function runCommandNoPty(options: {
	exec: ExecFunction;
	cmd: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdin?: Buffer | fs.ReadStream | Event<string>;
	output: Log;
	print?: boolean | 'continuous' | 'onerror';
}) {
	const { exec, cmd, args, cwd, env, stdin, output, print } = options;

	const p = await exec({
		cmd,
		args,
		cwd,
		env,
		output,
	});

	return new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		const stdoutDecoder = print === 'continuous' ? new StringDecoder() : undefined;
		p.stdout.on('data', (chunk: Buffer) => {
			stdout.push(chunk);
			if (print === 'continuous') {
				output.write(stdoutDecoder!.write(chunk));
			}
		});
		p.stdout.on('error', (err: any) => {
			// ENOTCONN seen with missing executable in addition to ENOENT on child_process.
			if (err?.code !== 'ENOTCONN') {
				throw err;
			}
		});
		const stderrDecoder = print === 'continuous' ? new StringDecoder() : undefined;
		p.stderr.on('data', (chunk: Buffer) => {
			stderr.push(chunk);
			if (print === 'continuous') {
				output.write(toErrorText(stderrDecoder!.write(chunk)));
			}
		});
		p.stderr.on('error', (err: any) => {
			// ENOTCONN seen with missing executable in addition to ENOENT on child_process.
			if (err?.code !== 'ENOTCONN') {
				throw err;
			}
		});
		const subs: Disposable[] = [];
		p.exit.then(({ code, signal }) => {
			try {
				const failed = !!code || !!signal;
				subs.forEach(sub => sub.dispose());
				const stdoutBuf = Buffer.concat(stdout);
				const stderrBuf = Buffer.concat(stderr);
				if (print === true || (failed && print === 'onerror')) {
					output.write(stdoutBuf.toString().replace(/\r?\n/g, '\r\n'));
					output.write(toErrorText(stderrBuf.toString()));
				}
				if (print && code) {
					output.write(`Exit code ${code}`);
				}
				if (print && signal) {
					output.write(`Process signal ${signal}`);
				}
				if (failed) {
					reject({
						message: `Command failed: ${cmd} ${(args || []).join(' ')}`,
						stdout: stdoutBuf,
						stderr: stderrBuf,
						code,
						signal,
					});
				} else {
					resolve({
						stdout: stdoutBuf,
						stderr: stderrBuf,
					});
				}
			} catch (e) {
				reject(e);
			}
		}, reject);
		if (stdin instanceof Buffer) {
			p.stdin.write(stdin, err => {
				if (err) {
					reject(err);
				}
			});
			p.stdin.end();
		} else if (stdin instanceof fs.ReadStream) {
			stdin.pipe(p.stdin);
		} else if (typeof stdin === 'function') {
			subs.push(stdin(buf => p.stdin.write(buf)));
		}
	});
}

export async function runCommand(options: {
	ptyExec: PtyExecFunction;
	cmd: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	output: Log;
	resolveOn?: RegExp;
	onDidInput?: Event<string>;
	stdin?: string;
	print?: 'off' | 'continuous' | 'end';
}) {
	const { ptyExec, cmd, args, cwd, env, output, resolveOn, onDidInput, stdin } = options;
	const print = options.print || 'continuous';

	const p = await ptyExec({
		cmd,
		args,
		cwd,
		env,
		output: output,
	});

	return new Promise<{ cmdOutput: string }>((resolve, reject) => {
		let cmdOutput = '';

		const subs: Disposable[] = [];
		if (p.write) {
			if (stdin) {
				p.write(stdin);
			}
			if (onDidInput) {
				subs.push(onDidInput(data => p.write!(data)));
			}
		}

		p.onData(chunk => {
			cmdOutput += chunk;
			if (print === 'continuous') {
				output.raw(chunk);
			}
			if (resolveOn && resolveOn.exec(cmdOutput)) {
				resolve({ cmdOutput });
			}
		});
		p.exit.then(({ code, signal }) => {
			try {
				if (print === 'end') {
					output.raw(cmdOutput);
				}
				subs.forEach(sub => sub?.dispose());
				if (code || signal) {
					reject({
						message: `Command failed: ${cmd} ${(args || []).join(' ')}`,
						cmdOutput,
						code,
						signal,
					});
				} else {
					resolve({ cmdOutput });
				}
			} catch (e) {
				reject(e);
			}
		}, e => {
			subs.forEach(sub => sub?.dispose());
			reject(e);
		});
	});
}

// From https://man7.org/linux/man-pages/man7/signal.7.html:
export const processSignals: Record<string, number | undefined> = {
	SIGHUP: 1,
	SIGINT: 2,
	SIGQUIT: 3,
	SIGILL: 4,
	SIGTRAP: 5,
	SIGABRT: 6,
	SIGIOT: 6,
	SIGBUS: 7,
	SIGEMT: undefined,
	SIGFPE: 8,
	SIGKILL: 9,
	SIGUSR1: 10,
	SIGSEGV: 11,
	SIGUSR2: 12,
	SIGPIPE: 13,
	SIGALRM: 14,
	SIGTERM: 15,
	SIGSTKFLT: 16,
	SIGCHLD: 17,
	SIGCLD: undefined,
	SIGCONT: 18,
	SIGSTOP: 19,
	SIGTSTP: 20,
	SIGTTIN: 21,
	SIGTTOU: 22,
	SIGURG: 23,
	SIGXCPU: 24,
	SIGXFSZ: 25,
	SIGVTALRM: 26,
	SIGPROF: 27,
	SIGWINCH: 28,
	SIGIO: 29,
	SIGPOLL: 29,
	SIGPWR: 30,
	SIGINFO: undefined,
	SIGLOST: undefined,
	SIGSYS: 31,
	SIGUNUSED: 31,
};

export function plainExec(defaultCwd: string | undefined): ExecFunction {
	return async function (params: ExecParameters): Promise<Exec> {
		const { cmd, args, stdio, output } = params;

		const text = `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`;
		const start = output.start(text);

		const cwd = params.cwd || defaultCwd;
		const env = params.env ? { ...process.env, ...params.env } : process.env;
		const exec = await findLocalWindowsExecutable(cmd, cwd, env, output);
		// --- Start Positron ---
		// On Windows, when exec contains spaces (like "C:\Program Files\..."), we need to quote it
		// Shell is needed for PATH resolution, but we must handle spaces in the executable path
		const needsShell = process.platform === 'win32' && !path.isAbsolute(exec);
		const spawnArgs = needsShell ? args : args;
		const spawnCmd = needsShell ? exec : exec;
		const p = cp.spawn(spawnCmd, spawnArgs, { cwd, env, stdio: stdio as any, windowsHide: true, shell: needsShell });
		// --- End Positron ---

		return {
			stdin: p.stdin,
			stdout: p.stdout,
			stderr: p.stderr,
			exit: new Promise((resolve, reject) => {
				p.once('error', err => {
					output.stop(text, start);
					reject(err);
				});
				p.once('close', (code, signal) => {
					output.stop(text, start);
					resolve({ code, signal });
				});
			}),
			async terminate() {
				p.kill('SIGKILL');
			}
		};
	};
}

export async function plainPtyExec(defaultCwd: string | undefined, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>, allowInheritTTY: boolean): Promise<PtyExecFunction> {
	const pty = await loadNativeModule<typeof ptyType>('node-pty');
	if (!pty) {
		const plain = plainExec(defaultCwd);
		return plainExecAsPtyExec(plain, allowInheritTTY);
	}

	return async function (params: PtyExecParameters): Promise<PtyExec> {
		const { cmd, args, output } = params;

		const text = `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`;
		const start = output.start(text);

		const useConpty = false; // TODO: Investigate using a shell with ConPTY. https://github.com/Microsoft/vscode-remote/issues/1234#issuecomment-485501275
		const cwd = params.cwd || defaultCwd;
		const env = params.env ? { ...process.env, ...params.env } : process.env;
		const exec = await findLocalWindowsExecutable(cmd, cwd, env, output);
		const p = pty.spawn(exec, args || [], {
			cwd,
			env: env as any,
			cols: output.dimensions?.columns,
			rows: output.dimensions?.rows,
			useConpty,
		});
		const subs = [
			output.onDidChangeDimensions && output.onDidChangeDimensions(e => p.resize(e.columns, e.rows))
		];

		return {
			onData: p.onData.bind(p),
			write: p.write.bind(p),
			resize: p.resize.bind(p),
			exit: new Promise(resolve => {
				p.onExit(({ exitCode, signal }) => {
					subs.forEach(sub => sub?.dispose());
					output.stop(text, start);
					resolve({ code: exitCode, signal });
					if (process.platform === 'win32') {
						try {
							// In some cases the process hasn't cleanly exited on Windows and the winpty-agent gets left around
							// https://github.com/microsoft/node-pty/issues/333
							p.kill();
						} catch {
						}
					}
				});
			}),
			async terminate() {
				p.kill('SIGKILL');
			}
		};
	};
}

export function plainExecAsPtyExec(plain: ExecFunction, allowInheritTTY: boolean): PtyExecFunction {
	return async function (params: PtyExecParameters): Promise<PtyExec> {
		const p = await plain({
			...params,
			stdio: allowInheritTTY && params.output !== nullLog ? [
				process.stdin.isTTY ? 'inherit' : 'pipe',
				process.stdout.isTTY ? 'inherit' : 'pipe',
				process.stderr.isTTY ? 'inherit' : 'pipe',
			] : undefined,
		});
		const onDataEmitter = new NodeEventEmitter<string>();
		if (p.stdout) {
			const stdoutDecoder = new StringDecoder();
			p.stdout.on('data', data => onDataEmitter.fire(stdoutDecoder.write(data)));
			p.stdout.on('close', () => {
				const end = stdoutDecoder.end();
				if (end) {
					onDataEmitter.fire(end);
				}
			});
		}
		if (p.stderr) {
			const stderrDecoder = new StringDecoder();
			p.stderr.on('data', data => onDataEmitter.fire(stderrDecoder.write(data)));
			p.stderr.on('close', () => {
				const end = stderrDecoder.end();
				if (end) {
					onDataEmitter.fire(end);
				}
			});
		}
		return {
			onData: onDataEmitter.event,
			write: p.stdin ? p.stdin.write.bind(p.stdin) : undefined,
			resize: () => { },
			exit: p.exit.then(({ code, signal }) => ({
				code: typeof code === 'number' ? code : undefined,
				signal: typeof signal === 'string' ? processSignals[signal] : undefined,
			})),
			terminate: p.terminate.bind(p),
		};
	};
}

async function findLocalWindowsExecutable(command: string, cwd = process.cwd(), env: Record<string, string | undefined>, output: Log): Promise<string> {
	if (process.platform !== 'win32') {
		return command;
	}

	// From terminalTaskSystem.ts.

	// If we have an absolute path then we take it.
	if (path.isAbsolute(command)) {
		return await findLocalWindowsExecutableWithExtension(command) || command;
	}
	if (/[/\\]/.test(command)) {
		// We have a directory and the directory is relative (see above). Make the path absolute
		// to the current working directory.
		const fullPath = path.join(cwd, command);
		return await findLocalWindowsExecutableWithExtension(fullPath) || fullPath;
	}
	let pathValue: string | undefined = undefined;
	let paths: string[] | undefined = undefined;
	// The options can override the PATH. So consider that PATH if present.
	if (env) {
		// Path can be named in many different ways and for the execution it doesn't matter
		for (const key of Object.keys(env)) {
			if (key.toLowerCase() === 'path') {
				const value = env[key];
				if (typeof value === 'string') {
					pathValue = value;
					paths = value.split(path.delimiter)
						.filter(Boolean);
					paths.push(path.join(env.ProgramW6432 || 'C:\\Program Files', 'Docker\\Docker\\resources\\bin')); // Fall back when newly installed.
				}
				break;
			}
		}
	}
	// No PATH environment. Bail out.
	if (paths === void 0 || paths.length === 0) {
		output.write(`findLocalWindowsExecutable: No PATH to look up executable '${command}'.`);
		const err = new Error(`No PATH to look up executable '${command}'.`);
		(err as any).code = 'ENOENT';
		throw err;
	}
	// We have a simple file name. We get the path variable from the env
	// and try to find the executable on the path.
	for (const pathEntry of paths) {
		// The path entry is absolute.
		let fullPath: string;
		if (path.isAbsolute(pathEntry)) {
			fullPath = path.join(pathEntry, command);
		} else {
			fullPath = path.join(cwd, pathEntry, command);
		}
		const withExtension = await findLocalWindowsExecutableWithExtension(fullPath);
		if (withExtension) {
			return withExtension;
		}
	}
	// Not found in PATH. Bail out.
	output.write(`findLocalWindowsExecutable: Exectuable '${command}' not found on PATH '${pathValue}'.`);
	const err = new Error(`Exectuable '${command}' not found on PATH '${pathValue}'.`);
	(err as any).code = 'ENOENT';
	throw err;
}

const pathext = process.env.PATHEXT;
const executableExtensions = pathext ? pathext.toLowerCase().split(';') : ['.com', '.exe', '.bat', '.cmd'];

async function findLocalWindowsExecutableWithExtension(fullPath: string) {
	if (executableExtensions.indexOf(path.extname(fullPath)) !== -1) {
		return await isLocalFile(fullPath) ? fullPath : undefined;
	}
	for (const ext of executableExtensions) {
		const withExtension = fullPath + ext;
		if (await isLocalFile(withExtension)) {
			return withExtension;
		}
	}
	return undefined;
}

export function parseVersion(str: string) {
	const m = /^'?v?(\d+(\.\d+)*)/.exec(str);
	if (!m) {
		return undefined;
	}
	return m[1].split('.')
		.map(i => parseInt(i, 10));
}

export function isEarlierVersion(left: number[], right: number[]) {
	for (let i = 0, n = Math.max(left.length, right.length); i < n; i++) {
		const l = left[i] || 0;
		const r = right[i] || 0;
		if (l !== r) {
			return l < r;
		}
	}
	return false; // Equal.
}

export async function loadNativeModule<T>(moduleName: string): Promise<T | undefined> {
	// Create a require function for dynamic module loading
	const dynamicRequire = createRequire(__filename);

	// Check NODE_PATH for Electron. Do this first to avoid loading a binary-incompatible version from the local node_modules during development.
	if (process.env.NODE_PATH) {
		for (const nodePath of process.env.NODE_PATH.split(path.delimiter)) {
			if (nodePath) {
				try {
					return dynamicRequire(`${nodePath}/${moduleName}`);
				} catch (err) {
					// Not available.
				}
			}
		}
	}
	try {
		return dynamicRequire(moduleName);
	} catch (err) {
		// Not available.
	}
	return undefined;
}

export type PlatformSwitch<T> = T | { posix: T; win32: T };

export function platformDispatch<T>(platform: NodeJS.Platform, platformSwitch: PlatformSwitch<T>): T {
	if (platformSwitch && typeof platformSwitch === 'object' && 'win32' in platformSwitch) {
		return platform === 'win32' ? platformSwitch.win32 : platformSwitch.posix;
	}
	return platformSwitch as T;
}

export async function isFile(shellServer: ShellServer, location: string) {
	return platformDispatch(shellServer.platform, {
		posix: async () => {
			try {
				await shellServer.exec(`test -f '${location}'`);
				return true;
			} catch (err) {
				return false;
			}
		},
		win32: async () => {
			return (await shellServer.exec(`Test-Path '${location}' -PathType Leaf`))
				.stdout.trim() === 'True';
		}
	})();
}

let localUsername: Promise<string>;
export async function getLocalUsername() {
	if (localUsername === undefined) {
		localUsername = (async () => {
			try {
				return os.userInfo().username;
			} catch (err) {
				if (process.platform !== 'linux') {
					throw err;
				}
				// os.userInfo() fails with VS Code snap install: https://github.com/microsoft/vscode-remote-release/issues/6913
				const result = await runCommandNoPty({ exec: plainExec(undefined), cmd: 'id', args: ['-u', '-n'], output: nullLog });
				return result.stdout.toString().trim();
			}
		})();
	}
	return localUsername;
}

export function getEntPasswdShellCommand(userNameOrId: string) {
	const escapedForShell = userNameOrId.replace(/['\\]/g, '\\$&');
	const escapedForRexExp = escapeRegExCharacters(userNameOrId)
		.replace(/'/g, '\\\'');
	// Leading space makes sure we don't concatenate to arithmetic expansion (https://tldp.org/LDP/abs/html/dblparens.html).
	return ` (command -v getent >/dev/null 2>&1 && getent passwd '${escapedForShell}' || grep -E '^${escapedForRexExp}|^[^:]*:[^:]*:${escapedForRexExp}:' /etc/passwd || true)`;
}
