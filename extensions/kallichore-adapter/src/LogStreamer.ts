/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Tail } from 'tail';

// Wrapper around Tail that flushes on `dispose()`.
// Prevents losing output on reload.

export class LogStreamer implements vscode.Disposable {
	private _tail: Tail;
	private _linesCounter: number = 0;

	constructor(
		private _output: vscode.OutputChannel,
		private _path: string,
		private _prefix?: string,
	) {
		this._tail = new Tail(this._path, { fromBeginning: true, useWatchFile: true });

		// Establish listeners for new lines in the log file
		this._tail.on('line', (line) => this.appendLine(line));
		this._tail.on('error', (error) => this.appendLine(error));
	}

	/**
	 * Starts watching the log file. Waits up to 10 seconds for the log file to
	 * be created if it doesn't exist.
	 */
	public async watch() {
		// Wait up to 10 seconds for the log file to be created.
		for (let retry = 0; retry < 50; retry++) {
			if (fs.existsSync(this._path)) {
				break;
			} else {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		if (!fs.existsSync(this._path)) {
			this.appendLine(`Log file '${this._path}' not found after 10 seconds.`);
			return;
		}

		// Initialise number of lines seen, which might not be zero as the
		// kernel might have already started outputting lines, or we might be
		// refreshing with an existing log file. This is used for flushing
		// the tail of the log on disposal. There is a race condition here so
		// this might be slightly off, causing duplicate lines in the tail of
		// the log.
		try {
			const lines = fs.readFileSync(this._path, 'utf8').split('\n');
			this._linesCounter = lines.length;
		} catch (err) {
			this.appendLine(`Error reading initial contents of log file '${this._path}': ${err.message || JSON.stringify(err)}`);
		}

		// Start watching the log file. This streams output until the streamer is
		// disposed.
		this._tail.watch();
	}

	private appendLine(line: string) {
		this._linesCounter += 1;

		if (this._prefix) {
			this._output.appendLine(`[${this._prefix}] ${line}`);
		} else {
			this._output.appendLine(line);
		}
	}

	public dispose() {
		this._tail.unwatch();

		if (!fs.existsSync(this._path)) {
			return;
		}

		const lines = fs.readFileSync(this._path, 'utf8').split('\n');

		// Push remaining lines in case new line events haven't had time to
		// fire up before unwatching. We skip lines that we've already seen and
		// flush the rest.
		for (let i = this._linesCounter + 1; i < lines.length; ++i) {
			this.appendLine(lines[i]);
		}
	}
}
