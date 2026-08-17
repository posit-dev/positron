/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICellRun {
	readonly language: string;
	/** The cell's code, or undefined when its text model is gone. */
	readonly code: string | undefined;
}

export interface ICellSplice {
	/** Leading cells that matched and are kept as they are. */
	readonly prefix: number;
	/** Old cells to remove, starting at `prefix`. */
	readonly removeCount: number;
	/** New cells to insert at `prefix`. */
	readonly insertCount: number;
}

/** A cell with no text model matches nothing: it cannot be carried across a splice. */
function sameCell(a: ICellRun, b: ICellRun): boolean {
	return a.code !== undefined && b.code !== undefined
		&& a.language === b.language
		&& a.code === b.code;
}

/**
 * The one contiguous region that has to be replaced to turn `oldCells` into
 * `newCells`, found by matching in from both ends so that every cell outside it
 * keeps its handle, its URI, and its extension host document.
 *
 * Matching cannot use the document model's cell id: that id embeds the index and
 * a content hash, so it changes under exactly the edits we need to match across.
 *
 * A content edit and a structural change arriving in the same parse widen the
 * region, which replaces more cells than necessary and is still correct.
 */
export function diffCellRuns(oldCells: readonly ICellRun[], newCells: readonly ICellRun[]): ICellSplice {
	const maxCommon = Math.min(oldCells.length, newCells.length);

	let prefix = 0;
	while (prefix < maxCommon && sameCell(oldCells[prefix], newCells[prefix])) {
		prefix++;
	}

	// Bounded by what the prefix left, so no cell is claimed by both ends.
	let suffix = 0;
	while (suffix < maxCommon - prefix
		&& sameCell(oldCells[oldCells.length - 1 - suffix], newCells[newCells.length - 1 - suffix])) {
		suffix++;
	}

	return {
		prefix,
		removeCount: oldCells.length - prefix - suffix,
		insertCount: newCells.length - prefix - suffix,
	};
}
