/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
import { spawn } from 'child_process';

/**
 * @typedef {{
 *   name: string;
 *   begins: RegExp;
 *   ends: RegExp;
 *   command: string[];
 * }} Options
 */

/** @typedef {'unknown' | 'compiling' | 'idle'} State */

/**
 * @param {string[]} args
 * @returns {Options}
 */
function parseArgs(args) {
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
		console.error(`Usage: deemon-status.mjs --name <name> --begins <regex> --ends <regex> --command <command>

Monitors a deemon build daemon and reports compilation status.

Options:
	--name     Display name for log output (optional, e.g., "client", "extensions")
	--begins   Regex pattern that matches the start of a compilation cycle
	--ends     Regex pattern that matches the end of a compilation cycle
	--command  The build command to run via deemon (e.g., "npm run watch-client")

Example:
	./scripts/deemon-status.mjs \\
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

/**
 * @param {string} name
 * @param {string} msg
 * @returns {void}
 */
function log(name, msg) {
	if (name) {
		console.log(`[${name}] ${msg}`);
	} else {
		console.log(msg);
	}
}

/**
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
	return str.replace(/\x1b\[[0-9;]*m/g, '');
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));

	const child = spawn('npx', ['deemon', '--attach', '--', ...opts.command], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let state = /** @type {State} */ ('unknown');
	/** @type {string[]} */
	let cycleLines = [];
	let replayDone = false;
	let idleAfterReplay = false;
	let noDaemon = false;
	/** @type {() => void} */
	let onIdle;

	/**
	 * @param {string} raw
	 * @returns {void}
	 */
	const processLine = (raw) => {
		if (raw.includes('[deemon]')) {
			if (/\[deemon\] (Spawned|Attached to running) build daemon/.test(raw)) {
				replayDone = true;
				if (state === 'idle') {
					idleAfterReplay = true;
					onIdle();
				}
			} else if (/\[deemon\] No daemon running/.test(raw)) {
				noDaemon = true;
			}
			return;
		}

		const line = stripAnsi(raw);

		if (opts.begins.test(line)) {
			state = 'compiling';
			cycleLines = [];
			cycleLines.push(raw);
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
	/**
	 * @param {Buffer} data
	 * @returns {void}
	 */
	const processData = (data) => {
		pending += data.toString();
		const lines = pending.split('\n');
		pending = lines.pop() || '';
		for (const line of lines) {
			processLine(line);
		}
	};

	/** @type {Promise<void>} */
	const done = new Promise((resolve) => {
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
		log(opts.name, `Daemon not running, start it first`);
		process.exit(1);
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
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
