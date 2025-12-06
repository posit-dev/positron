/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import { StringDecoder } from 'string_decoder';
import { ExecFunction, Exec, PlatformSwitch, platformDispatch } from './commonUtils';
import { Log, LogLevel } from '../spec-utils/log';

export interface ShellServer {
	exec(cmd: PlatformSwitch<string>, options?: { logLevel?: LogLevel; logOutput?: boolean | 'continuous' | 'silent'; stdin?: Buffer }): Promise<{ stdout: string; stderr: string }>;
	process: Exec;
	platform: NodeJS.Platform;
	path: typeof path.posix | typeof path.win32;
}

export const EOT = '\u2404';

export async function launch(remoteExec: ExecFunction | Exec, output: Log, agentSessionId?: string, platform: NodeJS.Platform = 'linux', hostName: 'Host' | 'Container' = 'Container'): Promise<ShellServer> {
	const isExecFunction = typeof remoteExec === 'function';
	const isWindows = platform === 'win32';
	const p = isExecFunction ? await remoteExec({
		env: agentSessionId ? { VSCODE_REMOTE_CONTAINERS_SESSION: agentSessionId } : {},
		cmd: isWindows ? 'powershell' : '/bin/sh',
		args: isWindows ? ['-NoProfile', '-Command', '-'] : [],
		output,
	}) : remoteExec;
	if (!isExecFunction) {
		// TODO: Pass in agentSessionId.
		const stdinText = isWindows
			? `powershell -NoProfile -Command "powershell -NoProfile -Command -"\n` // Nested PowerShell (for some reason) avoids the echo of stdin on stdout.
			: `/bin/sh -c 'echo ${EOT}; /bin/sh'\n`;
		p.stdin.write(stdinText);
		const eot = new Promise<void>(resolve => {
			let stdout = '';
			const stdoutDecoder = new StringDecoder();
			p.stdout.on('data', function eotListener(chunk: Buffer) {
				stdout += stdoutDecoder.write(chunk);
				if (stdout.includes(stdinText)) {
					p.stdout.off('data', eotListener);
					resolve();
				}
			});
		});
		await eot;
	}

	const monitor = monitorProcess(p);

	let lastExec: Promise<any> | undefined;
	async function exec(cmd: PlatformSwitch<string>, options?: { logLevel?: LogLevel; logOutput?: boolean | 'continuous' | 'silent'; stdin?: Buffer }) {
		const currentExec = lastExec = (async () => {
			try {
				await lastExec;
			} catch (err) {
				// ignore
			}
			return _exec(platformDispatch(platform, cmd), options);
		})();
		try {
			return await Promise.race([currentExec, monitor.unexpectedExit]);
		} finally {
			monitor.disposeStdioListeners();
			if (lastExec === currentExec) {
				lastExec = undefined;
			}
		}
	}

	async function _exec(cmd: string, options?: { logLevel?: LogLevel; logOutput?: boolean | 'continuous' | 'silent'; stdin?: Buffer }) {
		const text = `Run in ${hostName.toLowerCase()}: ${cmd.replace(/\n.*/g, '')}`;
		let start: number;
		if (options?.logOutput !== 'silent') {
			start = output.start(text, options?.logLevel);
		}
		if (p.stdin.destroyed) {
			output.write('Stdin closed!');
			const { code, signal } = await p.exit;
			return Promise.reject({ message: `Shell server terminated (code: ${code}, signal: ${signal})`, code, signal });
		}
		if (platform === 'win32') {
			p.stdin.write(`[Console]::Write('${EOT}'); ( ${cmd} ); [Console]::Write("${EOT}$LastExitCode ${EOT}"); [Console]::Error.Write('${EOT}')\n`);
		} else {
			p.stdin.write(`echo -n ${EOT}; ( ${cmd} ); echo -n ${EOT}$?${EOT}; echo -n ${EOT} >&2\n`);
		}
		const [stdoutP0, stdoutP] = read(p.stdout, [1, 2], options?.logOutput === 'continuous' ? (str, i, j) => {
			if (i === 1 && j === 0) {
				output.write(str, options?.logLevel);
			}
		} : () => undefined);
		const stderrP = read(p.stderr, [1], options?.logOutput === 'continuous' ? (str, i, j) => {
			if (i === 0 && j === 0) {
				output.write(str, options?.logLevel); // TODO
			}
		} : () => undefined)[0];
		if (options?.stdin) {
			await stdoutP0; // Wait so `cmd` has its stdin set up.
			p.stdin.write(options?.stdin);
		}
		const [stdout, codeStr] = await stdoutP;
		const [stderr] = await stderrP;
		const code = parseInt(codeStr, 10) || 0;
		if (options?.logOutput === undefined || options?.logOutput === true) {
			output.write(stdout, options?.logLevel);
			output.write(stderr, options?.logLevel); // TODO
			if (code) {
				output.write(`Exit code ${code}`, options?.logLevel);
			}
		}
		if (options?.logOutput === 'continuous' && code) {
			output.write(`Exit code ${code}`, options?.logLevel);
		}
		if (options?.logOutput !== 'silent') {
			output.stop(text, start!, options?.logLevel);
		}
		if (code) {
			return Promise.reject({ message: `Command in ${hostName.toLowerCase()} failed: ${cmd}`, code, stdout, stderr });
		}
		return { stdout, stderr };
	}

	return { exec, process: p, platform, path: platformDispatch(platform, path) };
}

function read(stream: NodeJS.ReadableStream, numberOfResults: number[], log: (str: string, i: number, j: number) => void) {
	const promises = numberOfResults.map(() => {
		let cbs: { resolve: (value: string[]) => void; reject: () => void };
		const promise = new Promise<string[]>((resolve, reject) => cbs = { resolve, reject });
		return { promise, ...cbs! };
	});
	const decoder = new StringDecoder('utf8');
	const strings: string[] = [];

	let j = 0;
	let results: string[] = [];
	function data(chunk: Buffer) {
		const str = decoder.write(chunk);
		consume(str);
	}
	function consume(str: string) {
		// console.log(`consume ${numberOfResults}: '${str}'`);
		const i = str.indexOf(EOT);
		if (i !== -1) {
			const s = str.substr(0, i);
			strings.push(s);
			log(s, j, results.length);
			// console.log(`result ${numberOfResults}: '${strings.join('')}'`);
			results.push(strings.join(''));
			strings.length = 0;
			if (results.length === numberOfResults[j]) {
				promises[j].resolve(results);
				j++;
				results = [];
				if (j === numberOfResults.length) {
					stream.off('data', data);
				}
			}
			if (i + 1 < str.length) {
				consume(str.substr(i + 1));
			}
		} else {
			strings.push(str);
			log(str, j, results.length);
		}
	}
	stream.on('data', data);

	return promises.map(p => p.promise);
}

function monitorProcess(p: Exec) {
	let processExited: (err: any) => void;
	const unexpectedExit = new Promise<never>((_resolve, reject) => processExited = reject);
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	const stdoutListener = (chunk: Buffer) => stdout.push(chunk);
	const stderrListener = (chunk: Buffer) => stderr.push(chunk);
	p.stdout.on('data', stdoutListener);
	p.stderr.on('data', stderrListener);
	p.exit.then(({ code, signal }) => {
		processExited(`Shell server terminated (code: ${code}, signal: ${signal})
${Buffer.concat(stdout).toString()}
${Buffer.concat(stderr).toString()}`);
	}, err => {
		processExited(`Shell server failed: ${err && (err.stack || err.message)}`);
	});
	const disposeStdioListeners = () => {
		p.stdout.off('data', stdoutListener);
		p.stderr.off('data', stderrListener);
		stdout.length = 0;
		stderr.length = 0;
	};
	return {
		unexpectedExit,
		disposeStdioListeners,
	};
}
