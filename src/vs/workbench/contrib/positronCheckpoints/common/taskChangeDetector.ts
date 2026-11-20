/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The task-change detector of spec 7.1. It is a pure class: it reads no clock and calls no
// model. Its caller passes each event with the time it happened, in milliseconds, and starts the
// "split into chunks" job when an event gives `signal`.

/** The numbers the detector uses. */
export interface DetectorConfig {
	/** A pause in editing of at least this long, followed by an edit, is a signal. */
	pauseMs: number;
	/** More changed lines than this is a signal. */
	maxLines: number;
	/** More changed files than this is a signal. */
	maxFiles: number;
	/** The shortest time between two signals. Each dismissal doubles it. */
	minGapMs: number;
}

/** The starting values of spec 7.1. */
export const DEFAULT_DETECTOR: DetectorConfig = { pauseMs: 20 * 60_000, maxLines: 300, maxFiles: 8, minGapMs: 10 * 60_000 };

/** What happened, and when. */
export type DetectorEvent =
	/** The person edited the file at `path`, which is or is not in the set of changed files. */
	| { type: 'edit'; path: string; inChangedSet: boolean; time: number }
	/** The unrecorded changes now have this many changed lines and files. */
	| { type: 'changes'; lines: number; files: number; time: number }
	/** The person dismissed a suggestion. */
	| { type: 'dismissed'; time: number }
	/** A checkpoint was created. */
	| { type: 'checkpoint-created'; time: number };

/**
 * Decides when the person seems to move to a new task (spec 7.1). Each event gives `signal` or
 * `none`. The signals are:
 *
 * - an edit outside the set of changed files, after at least one edit inside it since the last
 *   checkpoint;
 * - an edit after a pause in editing of at least `pauseMs`;
 * - changes with more than `maxLines` lines or more than `maxFiles` files.
 *
 * There is never a signal while there are no changes, or within the current gap after the
 * previous signal. The gap starts at `minGapMs` and doubles after each dismissal.
 */
export class TaskChangeDetector {
	private readonly _config: DetectorConfig;
	private _gapMs: number;
	private _lastSignalTime: number | undefined;
	private _lastEditTime: number | undefined;
	private _editedInsideSet = false;
	/** False until a `changes` event reports changed lines or files. */
	private _hasChanges = false;

	constructor(config: DetectorConfig = DEFAULT_DETECTOR) {
		this._config = config;
		this._gapMs = config.minGapMs;
	}

	handle(event: DetectorEvent): 'signal' | 'none' {
		switch (event.type) {
			case 'edit': {
				const afterPause = this._lastEditTime !== undefined && event.time - this._lastEditTime >= this._config.pauseMs;
				const leftTheSet = !event.inChangedSet && this._editedInsideSet;
				this._lastEditTime = event.time;
				if (event.inChangedSet) {
					this._editedInsideSet = true;
				}
				return this._signalIf(afterPause || leftTheSet, event.time);
			}
			case 'changes':
				this._hasChanges = event.lines > 0 || event.files > 0;
				return this._signalIf(event.lines > this._config.maxLines || event.files > this._config.maxFiles, event.time);
			case 'dismissed':
				this._gapMs *= 2;
				return 'none';
			case 'checkpoint-created':
				this._editedInsideSet = false;
				return 'none';
		}
	}

	/** Gives `signal` when `condition` holds, there are changes, and the gap has passed. */
	private _signalIf(condition: boolean, time: number): 'signal' | 'none' {
		if (!condition || !this._hasChanges) {
			return 'none';
		}
		if (this._lastSignalTime !== undefined && time - this._lastSignalTime < this._gapMs) {
			return 'none';
		}
		this._lastSignalTime = time;
		return 'signal';
	}
}
