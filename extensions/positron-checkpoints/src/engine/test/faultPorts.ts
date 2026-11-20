/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnginePorts, FilePort, GitRunner } from '../ports';

/** The error every call returns after a simulated crash. */
export class EngineStopped extends Error {
	constructor() {
		super('The engine stopped');
		this.name = 'EngineStopped';
	}
}

export interface FaultPorts extends EnginePorts {
	/** One label per mutating call made so far, in order: the method or git command, then its first path or ref. */
	readonly mutatingCalls: string[];
}

/** Git commands that change the branch, the index, or working files. */
const MUTATING_GIT_COMMANDS = new Set(['update-ref', 'read-tree', 'reset', 'checkout-index']);

/** The git command of `args`, after global options such as `-C <dir>` and `-c <setting>`. */
function gitCommand(args: string[]): { command: string; rest: string[] } {
	let index = 0;
	while (index < args.length && args[index].startsWith('-')) {
		index += args[index] === '-C' || args[index] === '-c' ? 2 : 1;
	}
	return { command: args[index] ?? '', rest: args.slice(index + 1) };
}

/**
 * Wraps `ports` for failure injection. Mutating calls are counted: `files.write`,
 * `files.remove`, `files.move`, and git calls whose command is `update-ref`, `read-tree`,
 * `reset`, or `checkout-index`. Mutating call number `failAt` rejects without being made.
 * From mutating call number `stopAt` onward, every call (reading ones too) rejects with
 * `EngineStopped`, which simulates a crash.
 */
export function faultPorts(ports: EnginePorts, plan: { failAt?: number; stopAt?: number }): FaultPorts {
	const mutatingCalls: string[] = [];
	let stopped = false;

	const gate = (label: string | undefined) => {
		if (stopped) {
			throw new EngineStopped();
		}
		if (label === undefined) {
			return;
		}
		mutatingCalls.push(label);
		const number = mutatingCalls.length;
		if (plan.stopAt !== undefined && number >= plan.stopAt) {
			stopped = true;
			throw new EngineStopped();
		}
		if (number === plan.failAt) {
			throw new Error(`injected failure at mutating call ${number}: ${label}`);
		}
	};

	const inner = ports.files;
	const files: FilePort = {
		read: async file => { gate(undefined); return inner.read(file); },
		write: async (file, content, executable) => { gate(`write ${file}`); return inner.write(file, content, executable); },
		remove: async file => { gate(`remove ${file}`); return inner.remove(file); },
		move: async (from, to) => { gate(`move ${from}`); return inner.move(from, to); },
		stat: async file => { gate(undefined); return inner.stat(file); },
		lstat: async file => { gate(undefined); return inner.lstat(file); },
		copyKeepingTime: async (from, to) => { gate(undefined); return inner.copyKeepingTime(from, to); },
		appendDurable: async (file, line) => { gate(undefined); return inner.appendDurable(file, line); },
		createExclusive: async (file, content) => { gate(undefined); return inner.createExclusive(file, content); },
		caseInsensitive: async () => { gate(undefined); return inner.caseInsensitive(); },
	};

	const git: GitRunner = async (args, options) => {
		const { command, rest } = gitCommand(args);
		gate(MUTATING_GIT_COMMANDS.has(command) ? `${command} ${rest.filter(arg => !arg.startsWith('-'))[0] ?? ''}` : undefined);
		return ports.git(args, options);
	};

	return { ...ports, files, git, mutatingCalls };
}
