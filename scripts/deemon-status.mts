/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawn } from 'node:child_process';

interface Options {
	name: string;
	begins: RegExp;
	ends: RegExp;
	command: string[];
}

type State = 'unknown' | 'compiling' | 'idle';

const DEEMON_READY = /\[deemon\] (Spawned|Attached to running) build daemon/;
const DEEMON_MISSING = /\[deemon\] No daemon running/;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function parseArgs(args: string[]): Options {
	let name = '';
	let begins = '';
	let ends = '';
	let command = '';

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--name': name = args[++i]; break;
			case '--begins': begins = args[++i]; break;
			case '--ends': ends = args[++i]; break;
			case '--command': command = args[++i]; break;
		}
	}

	if (!begins || !ends || !command) {
		console.error(`Usage: deemon-status.mts --name <name> --begins <regex> --ends <regex> --command <command>

Monitors a deemon build daemon and reports compilation status.

Options:
	--name     Display name for log output (optional, e.g., "client", "extensions")
	--begins   Regex pattern that matches the start of a compilation cycle
	--ends     Regex pattern that matches the end of a compilation cycle
	--command  The build command to run via deemon (e.g., "npm run watch-client")

Example:
	./scripts/deemon-status.mts \\
		--name client \\
		--begins "Starting compilation" \\
		--ends "Finished compilation" \\
		--command "npm run watch-client"
`);
		process.exit(1);
	}

	return {
		name,
		begins: new RegExp(begins),
		ends: new RegExp(ends),
		command: command.split(' '),
	};
}

function log(name: string, msg: string): void {
	console.log(name ? `[${name}] ${msg}` : msg);
}

function stripAnsi(str: string): string {
	return str.replace(ANSI_ESCAPE, '');
}

const opts = parseArgs(process.argv.slice(2));

const child = spawn('npx', ['deemon', '--attach', '--', ...opts.command], {
	stdio: ['ignore', 'pipe', 'pipe'],
});

// These variables are mutated inside callbacks (processLine/processData), but
// TS control flow analysis doesn't track closure mutations, so it narrows
// them to their initial literal types. The 'as' casts prevent that narrowing.
let state = 'unknown' as State;
let cycleLines: string[] = [];
let replayDone = false as boolean;
let idleAfterReplay = false as boolean;
let noDaemon = false as boolean;
let onIdle: () => void;

const processLine = (raw: string): void => {
	if (raw.includes('[deemon]')) {
		if (DEEMON_READY.test(raw)) {
			replayDone = true;
			if (state === 'idle') {
				idleAfterReplay = true;
				onIdle();
			}
		} else if (DEEMON_MISSING.test(raw)) {
			noDaemon = true;
		}
		return;
	}

	const line = stripAnsi(raw);

	if (opts.begins.test(line)) {
		state = 'compiling';
		cycleLines = [raw];
		if (replayDone) {
			log(opts.name, raw);
		}
		return;
	}

	if (opts.ends.test(line)) {
		cycleLines.push(raw);
		state = 'idle';
		if (replayDone) {
			log(opts.name, raw);
			onIdle();
		}
		return;
	}

	if (state === 'compiling') {
		cycleLines.push(raw);
		if (replayDone) {
			log(opts.name, raw);
		}
	}
};

let pending = '';

const processData = (data: Buffer): void => {
	pending += data.toString();
	const lines = pending.split('\n');
	pending = lines.pop() || '';
	for (const line of lines) {
		processLine(line);
	}
};

const done: Promise<void> = new Promise((resolve) => {
	onIdle = () => {
		child.kill();
		resolve();
	};
	child.on('close', resolve);
});

child.stdout.on('data', processData);
child.stderr.on('data', processData);

await done;

if (noDaemon) {
	log(opts.name, `Daemon not running`);
} else if (state === 'idle') {
	if (idleAfterReplay) {
		for (const line of cycleLines) {
			log(opts.name, line);
		}
	}
} else {
	log(opts.name, 'Daemon stopped before reaching idle');
	process.exit(1);
}
