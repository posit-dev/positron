/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** A row of `ps -A -o pid=,ppid=,pgid=,tpgid=,args=`. */
export interface ProcessInfo {
	readonly pid: number;
	readonly ppid: number;
	/** Process group. */
	readonly pgid: number;
	/** Foreground process group of the process's terminal; 0 or -1 when it has none. */
	readonly tpgid: number;
	/** Command line. */
	readonly args: string;
}

/** Arguments for `ps` that list every process in the shape {@link parseProcessTable} reads. */
export const PS_ARGS = ['-A', '-o', 'pid=,ppid=,pgid=,tpgid=,args='];

/** Parse the output of `ps` run with {@link PS_ARGS}. */
export function parseProcessTable(output: string): ProcessInfo[] {
	const processes: ProcessInfo[] = [];
	for (const line of output.split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<pgid>\d+)\s+(?<tpgid>-?\d+)\s+(?<args>.*)$/.exec(line);
		if (match?.groups) {
			processes.push({
				pid: Number(match.groups.pid),
				ppid: Number(match.groups.ppid),
				pgid: Number(match.groups.pgid),
				tpgid: Number(match.groups.tpgid),
				args: match.groups.args,
			});
		}
	}
	return processes;
}

/**
 * Whether the foreground job of the terminal whose process is `rootPid` is a
 * matching command. Only the process tree under `rootPid` is searched, and a
 * process counts only while its group is the terminal's foreground group, so
 * a suspended or backgrounded job does not.
 * @param rootPid The terminal's process, usually its shell.
 */
export function hasForegroundProcess(
	processes: readonly ProcessInfo[],
	rootPid: number,
	matches: (args: string) => boolean,
): boolean {
	const childrenByPid = new Map<number, ProcessInfo[]>();
	for (const process of processes) {
		const children = childrenByPid.get(process.ppid) ?? [];
		children.push(process);
		childrenByPid.set(process.ppid, children);
	}

	// Walk the tree from the terminal's own process, which is the agent
	// itself when the terminal was started running it.
	const pending = processes.filter(process => process.pid === rootPid);
	while (pending.length > 0) {
		const process = pending.pop()!;
		if (process.tpgid > 0 && process.pgid === process.tpgid && matches(process.args)) {
			return true;
		}
		pending.push(...(childrenByPid.get(process.pid) ?? []));
	}
	return false;
}

/**
 * Whether a command line runs Claude Code: the native `claude` executable,
 * or the npm package's CLI script under Node.
 */
export function isClaudeCodeCommand(args: string): boolean {
	const executable = args.split(/\s+/, 1)[0];
	return /(^|[\\/])claude(\.exe)?$/i.test(executable) || isNodeScriptCommand(args, /@anthropic-ai[\\/]claude-code[\\/]cli\.js$/);
}

/**
 * Whether a command line runs Codex: the native `codex` executable, or the
 * npm package's launcher under Node.
 */
export function isCodexCommand(args: string): boolean {
	const executable = args.split(/\s+/, 1)[0];
	return /(^|[\\/])codex(\.exe)?$/i.test(executable) || isNodeScriptCommand(args, /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
}

/**
 * Whether a command line runs a script under Node: the executable is `node`
 * and its first argument is the script, so that other programs merely
 * opening the script (e.g. an editor) don't match.
 */
function isNodeScriptCommand(args: string, script: RegExp): boolean {
	const [executable, first] = args.split(/\s+/, 2);
	return /(^|[\\/])node(\.exe)?$/i.test(executable) && first !== undefined && script.test(first);
}
