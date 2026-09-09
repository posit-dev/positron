/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISequence, LcsDiff } from '../../../../base/common/diff/diff.js';
import { QuartoCodeCell } from './quartoTypes.js';

/**
 * A per-cell association (a view zone, a cell toolbar, ...) that needs to be
 * re-anchored to a current cell after a reparse. `id` is the association's
 * key, expected to equal a `QuartoCodeCell.id` while it is still valid.
 */
export interface ICellAssociation {
	readonly id: string;
	readonly contentHash: string;
}

/**
 * Result of re-anchoring one association. `moved` covers both an actual
 * relocation and the no-op case where `oldId` already equals `newCell.id`:
 * either way the caller refreshes from `newCell` the same way.
 */
export type CellReconciliation =
	| { readonly kind: 'moved'; readonly oldId: string; readonly newCell: QuartoCodeCell }
	| { readonly kind: 'orphaned'; readonly id: string };

/**
 * The one piece of `IQuartoDocumentModel` this module needs. A structural
 * subset rather than the full interface, so a caller with a real document
 * model satisfies it without change, and a test can supply a plain array.
 */
export interface IQuartoCellSource {
	readonly cells: readonly QuartoCodeCell[];
}

/** A cell sequence for `LcsDiff`, compared by content hash. */
class CellHashSequence implements ISequence {
	private readonly _hashes: string[];

	constructor(cells: readonly QuartoCodeCell[]) {
		this._hashes = cells.map(cell => cell.contentHash);
	}

	getElements(): string[] {
		return this._hashes;
	}
}

/**
 * Re-anchors associations to their current cells by aligning the previous
 * and current cell sequences on content hash. A stale `id` resolving to
 * *some* cell doesn't prove it resolves to the *same* one: ids embed their
 * index (`{index}-{hashPrefix}-{label}`), so identical-content cells can
 * swap which one an old id names across a shift.
 *
 * The alignment is a whole-document LCS diff over the hash sequences, so an
 * unchanged cell keeps its association no matter what changed elsewhere in
 * the document -- including an edit or deletion of a same-content sibling,
 * which per-hash-group reasoning cannot tell apart from the cell itself
 * moving. Within a run of identical cells the diff cannot know which twin
 * was added or removed; when it deems a *tracked* cell deleted while an
 * untracked twin from the same run survives, the association inherits the
 * twin's aligned cell rather than being orphaned, since identical content
 * makes the surviving twin an equally good home for it. (When both twins
 * are tracked, one orphan is unavoidable -- a cell really did vanish.)
 *
 * An association whose id is missing from `previousCells` entirely (no
 * prior parse recorded) falls back to matching by content hash, in
 * id-index order, against cells no aligned association claimed.
 */
export function reconcileCellAssociations(
	model: IQuartoCellSource,
	previousCells: readonly QuartoCodeCell[],
	associations: readonly ICellAssociation[],
): CellReconciliation[] {
	const currentCells = model.cells;

	// Align the two cell sequences; unchanged blocks map an old array
	// position to its new one.
	const oldToNew = alignCellSequences(previousCells, currentCells);

	const previousPositionById = new Map<string, number>();
	previousCells.forEach((cell, position) => previousPositionById.set(cell.id, position));

	const results: (CellReconciliation | undefined)[] = new Array(associations.length);
	const claimedNewPositions = new Set<number>();
	const orphanedPositions: number[] = [];
	const fallbackPositions: number[] = [];

	// Aligned path: an association whose previous cell still has an aligned
	// counterpart moves to it; one whose previous cell was deleted (or
	// edited into different content) is tentatively orphaned.
	associations.forEach((association, position) => {
		const oldPosition = previousPositionById.get(association.id);
		if (oldPosition === undefined) {
			fallbackPositions.push(position);
			return;
		}
		const newPosition = oldToNew.get(oldPosition);
		if (newPosition === undefined) {
			orphanedPositions.push(position);
			return;
		}
		claimedNewPositions.add(newPosition);
		results[position] = { kind: 'moved', oldId: association.id, newCell: currentCells[newPosition] };
	});

	// Rescue pass: a tentatively orphaned association whose previous cell
	// sat in a run of identical cells inherits the aligned cell of an
	// untracked twin from that run, if one exists. The diff's choice of
	// which twin was deleted is arbitrary, so prefer the choice that keeps
	// tracked state alive.
	const trackedIds = new Set(associations.map(association => association.id));
	for (const position of orphanedPositions) {
		const association = associations[position];
		const oldPosition = previousPositionById.get(association.id)!;
		const rescued = findUntrackedTwinCell(previousCells, oldPosition, oldToNew, trackedIds, claimedNewPositions);
		if (rescued !== undefined) {
			claimedNewPositions.add(rescued);
			results[position] = { kind: 'moved', oldId: association.id, newCell: currentCells[rescued] };
		}
	}

	// Fallback path: associations with no entry in the previous cell list
	// match by content hash, in id-index order, against unclaimed cells.
	const fallbackCandidates = new Map<string, number[]>();
	currentCells.forEach((cell, position) => {
		if (claimedNewPositions.has(position)) {
			return;
		}
		const candidates = fallbackCandidates.get(cell.contentHash);
		if (candidates) {
			candidates.push(position);
		} else {
			fallbackCandidates.set(cell.contentHash, [position]);
		}
	});
	const orderedFallbacks = [...fallbackPositions].sort((a, b) =>
		(parsePreviousIndex(associations[a].id) ?? 0) - (parsePreviousIndex(associations[b].id) ?? 0));
	for (const position of orderedFallbacks) {
		const association = associations[position];
		const candidates = fallbackCandidates.get(association.contentHash);
		const newPosition = candidates?.shift();
		if (newPosition === undefined) {
			continue;
		}
		results[position] = { kind: 'moved', oldId: association.id, newCell: currentCells[newPosition] };
	}

	// Anything still unresolved is genuinely orphaned.
	return associations.map((association, position) =>
		results[position] ?? { kind: 'orphaned', id: association.id });
}

/**
 * Maps each previous-cell array position to its current array position via
 * an LCS diff of the two content-hash sequences. Positions inside changed
 * regions have no entry.
 */
function alignCellSequences(
	previousCells: readonly QuartoCodeCell[],
	currentCells: readonly QuartoCodeCell[],
): Map<number, number> {
	const { changes } = new LcsDiff(
		new CellHashSequence(previousCells),
		new CellHashSequence(currentCells),
	).ComputeDiff(false);

	const oldToNew = new Map<number, number>();
	let oldPosition = 0;
	let newPosition = 0;
	for (const change of changes) {
		// The gap before this change is an unchanged block.
		let alignedNew = newPosition;
		for (let alignedOld = oldPosition; alignedOld < change.originalStart; alignedOld++) {
			oldToNew.set(alignedOld, alignedNew++);
		}
		oldPosition = change.originalStart + change.originalLength;
		newPosition = change.modifiedStart + change.modifiedLength;
	}
	let alignedNew = newPosition;
	for (let alignedOld = oldPosition; alignedOld < previousCells.length; alignedOld++) {
		oldToNew.set(alignedOld, alignedNew++);
	}
	return oldToNew;
}

/**
 * The aligned current position of an untracked twin of the deleted cell at
 * `oldPosition`: another cell from the same maximal run of identical
 * content in `previousCells` that no association tracks and whose aligned
 * cell no result has claimed. `undefined` when no such twin exists.
 */
function findUntrackedTwinCell(
	previousCells: readonly QuartoCodeCell[],
	oldPosition: number,
	oldToNew: Map<number, number>,
	trackedIds: ReadonlySet<string>,
	claimedNewPositions: ReadonlySet<number>,
): number | undefined {
	const contentHash = previousCells[oldPosition].contentHash;
	let runStart = oldPosition;
	while (runStart > 0 && previousCells[runStart - 1].contentHash === contentHash) {
		runStart--;
	}
	let runEnd = oldPosition;
	while (runEnd < previousCells.length - 1 && previousCells[runEnd + 1].contentHash === contentHash) {
		runEnd++;
	}
	for (let twin = runStart; twin <= runEnd; twin++) {
		if (twin === oldPosition || trackedIds.has(previousCells[twin].id)) {
			continue;
		}
		const newPosition = oldToNew.get(twin);
		if (newPosition !== undefined && !claimedNewPositions.has(newPosition)) {
			return newPosition;
		}
	}
	return undefined;
}

/** The leading digits of a cell id are its index; `NaN` becomes "no preference". */
function parsePreviousIndex(id: string): number | undefined {
	const index = parseInt(id, 10);
	return Number.isNaN(index) ? undefined : index;
}
