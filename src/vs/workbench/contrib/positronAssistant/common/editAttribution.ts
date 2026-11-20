/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LcsDiff } from '../../../../base/common/diff/diff.js';
import { IPositronTrackedEditState } from './positronEditReview.js';

/** One group of edits' change to a file: its text before and after; undefined while it does not exist. */
export interface IChange {
	readonly before: string | undefined;
	readonly after: string | undefined;
}

/** A line of the file, and which change wrote it. */
interface ILine {
	readonly text: string;
	/** The index of the change that added the line; undefined for lines it did not add. */
	readonly owner: number | undefined;
	/** The line's index in the text before the first change; undefined for lines added since. */
	readonly origin: number | undefined;
}

/**
 * What became of each of `changes`, made in order to one file, as the user
 * reviews them. `baseline` is the file with the changes kept so far and
 * `current` is the file as the editor has it; once the review is over, both
 * are the file's final text.
 *
 * Each line a change added, or original line it deleted, is kept when the
 * baseline has the change, pending when only the editor does, and undone when
 * neither does. A change whose lines were all rewritten by later changes
 * shares the outcome of the file as a whole.
 */
export function changeStates(changes: readonly IChange[], baseline: string, current: string): IPositronTrackedEditState[] {
	const original = lines(changes[0]?.before);
	let file: ILine[] = original.map((text, origin) => ({ text, owner: undefined, origin }));
	// The change that deleted each original line, by the line's index.
	const deletedBy = new Map<number, number>();
	changes.forEach((change, index) => {
		// The file may have been edited outside the changes since the previous one.
		file = rebase(file, lines(change.before), undefined, deletedBy);
		file = rebase(file, lines(change.after), index, deletedBy);
	});

	const baselineLines = lines(baseline);
	const currentLines = lines(current);
	const fileText = file.map(line => line.text);
	const addedInBaseline = present(fileText, baselineLines);
	const addedInCurrent = present(fileText, currentLines);
	const originalInBaseline = present(original, baselineLines);
	const originalInCurrent = present(original, currentLines);

	const outcomes = changes.map(() => new Set<IPositronTrackedEditState>());
	const all = new Set<IPositronTrackedEditState>();
	const add = (owner: number, outcome: IPositronTrackedEditState) => {
		outcomes[owner].add(outcome);
		all.add(outcome);
	};
	file.forEach((line, i) => {
		if (line.owner !== undefined) {
			add(line.owner, addedInBaseline[i] ? 'kept' : addedInCurrent[i] ? 'pending' : 'undone');
		}
	});
	for (const [origin, owner] of deletedBy) {
		add(owner, !originalInBaseline[origin] ? 'kept' : originalInCurrent[origin] ? 'undone' : 'pending');
	}
	const whole = combine(all);
	return outcomes.map(outcome => outcome.size > 0 ? combine(outcome) : whole);
}

function lines(text: string | undefined): string[] {
	return text === undefined || text === '' ? [] : text.split('\n');
}

/** For each line of `from`, its index in `to`, or undefined when `to` lacks it. */
function match(from: readonly string[], to: readonly string[]): (number | undefined)[] {
	const result: (number | undefined)[] = [];
	let i = 0;
	let j = 0;
	const { changes } = new LcsDiff({ getElements: () => [...from] }, { getElements: () => [...to] }).ComputeDiff(false);
	for (const change of changes) {
		while (i < change.originalStart) {
			result[i++] = j++;
		}
		for (let k = 0; k < change.originalLength; k++) {
			result[i++] = undefined;
		}
		j += change.modifiedLength;
	}
	while (i < from.length) {
		result[i++] = j++;
	}
	return result;
}

/**
 * Carry `file` over to `target`: lines both share keep their owner, lines
 * only `target` has belong to `owner`, and original lines `target` drops are
 * recorded as deleted by `owner`.
 */
function rebase(file: readonly ILine[], target: readonly string[], owner: number | undefined, deletedBy: Map<number, number>): ILine[] {
	const result: ILine[] = target.map(text => ({ text, owner, origin: undefined }));
	match(file.map(line => line.text), target).forEach((j, i) => {
		const line = file[i];
		if (j !== undefined) {
			result[j] = line;
		} else if (owner !== undefined && line.origin !== undefined) {
			deletedBy.set(line.origin, owner);
		}
	});
	return result;
}

/** Whether each line of `from` is still in `to`. */
function present(from: readonly string[], to: readonly string[]): boolean[] {
	return match(from, to).map(j => j !== undefined);
}

function combine(outcomes: ReadonlySet<IPositronTrackedEditState>): IPositronTrackedEditState {
	if (outcomes.has('pending')) {
		return 'pending';
	}
	return outcomes.size === 1 ? [...outcomes][0] : outcomes.size === 0 ? 'kept' : 'partial';
}
