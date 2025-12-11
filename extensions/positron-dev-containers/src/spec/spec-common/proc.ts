/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellServer } from './shellServer';

export interface Process {
	pid: string;
	ppid: string | undefined;
	pgrp: string | undefined;
	cwd: string;
	mntNS: string;
	cmd: string;
	env: Record<string, string>;
}

export async function findProcesses(shellServer: ShellServer) {
	const ps = 'for pid in `cd /proc && ls -d [0-9]*`; do { echo $pid ; readlink /proc/$pid/cwd ; readlink /proc/$pid/ns/mnt ; cat /proc/$pid/stat | tr "\n" " " ; echo ; xargs -0 < /proc/$pid/environ ; xargs -0 < /proc/$pid/cmdline ; } ; echo --- ; done ; readlink /proc/self/ns/mnt 2>/dev/null';
	const { stdout } = await shellServer.exec(ps, { logOutput: false });

	const n = 6;
	const sections = stdout.split('\n---\n');
	const mntNS = sections.pop()!.trim();
	const processes: Process[] = sections
		.map(line => line.split('\n'))
		.filter(parts => parts.length >= n)
		.map(([pid, cwd, mntNS, stat, env, cmd]) => {
			const statM: (string | undefined)[] = /.*\) [^ ]* ([^ ]*) ([^ ]*)/.exec(stat) || [];
			return {
				pid,
				ppid: statM[1],
				pgrp: statM[2],
				cwd,
				mntNS,
				cmd,
				env: env.split(' ')
					.reduce((env, current) => {
						const i = current.indexOf('=');
						if (i !== -1) {
							env[current.substr(0, i)] = current.substr(i + 1);
						}
						return env;
					}, {} as Record<string, string>),
			};
		});
	return {
		processes,
		mntNS,
	};
}

export interface ProcessTree {
	process: Process;
	childProcesses: ProcessTree[];
}

export function buildProcessTrees(processes: Process[]) {
	const index: Record<string, ProcessTree> = {};
	processes.forEach(process => index[process.pid] = { process, childProcesses: [] });
	processes.filter(p => p.ppid)
		.forEach(p => index[p.ppid!]?.childProcesses.push(index[p.pid]));
	return index;
}

export function processTreeToString(tree: ProcessTree, singleIndent = '  ', currentIndent = '  '): string {
	return `${currentIndent}${tree.process.pid}: ${tree.process.cmd}
${tree.childProcesses.map(p => processTreeToString(p, singleIndent, currentIndent + singleIndent))}`;
}
