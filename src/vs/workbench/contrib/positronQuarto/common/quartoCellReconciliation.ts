/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISequence, LcsDiff } from '../../../../base/common/diff/diff.js';
import { QuartoCodeCell } from './quartoTypes.js';

/**
 * A per-cell association (a view zone, a cell toolbar, ...) to re-anchor
 * to a current cell after a reparse. `id` equals a `QuartoCodeCell.id`
 * while still valid.
 */
export interface ICellAssociation {
	readonly id: string;
	readonly contentHash: string;
}

/**
 * Result of re-anchoring one association. `moved` also covers the no-op
 * case `oldId === newCell.id`; the caller refreshes from `newCell` either
 * way.
 */
export type CellReconciliation =
	| { readonly kind: 'moved'; readonly oldId: string; readonly newCell: QuartoCodeCell }
	| { readonly kind: 'orphaned'; readonly id: string };

/**
 * The one piece of `IQuartoDocumentModel` this module needs. A structural
 * subset, so a test can supply a plain array.
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
 * Re-anchors associations to their current cells after a reparse. A stale
 * `id` resolving to *some* cell doesn't prove it resolves to the *same*
 * one: ids embed their index (`{index}-{hashPrefix}-{label}`), so
 * identical-content cells can swap which one an old id names across a
 * shift.
 *
 * Strategy: align the previous and current content-hash sequences with a
 * whole-document LCS diff, then let each unmatched association claim an
 * unclaimed current cell with the same hash. The diff reads a reorder as
 * deletion plus insertion, and which of several identical cells it deems
 * deleted is arbitrary, so prefer the outcome that keeps tracked state
 * alive -- identical content makes any survivor an equally good home. An
 * association with no unclaimed same-hash cell is genuinely orphaned.
 *
 * Associations missing from `previousCells` (no prior parse recorded) fall
 * back to the same hash matching, in id-index order.
 */
export function reconcileCellAssociations(
	model: IQuartoCellSource,
	previousCells: readonly QuartoCodeCell[],
	associations: readonly ICellAssociation[],
): CellReconciliation[] {
	const currentCells = model.cells;

	// Whole-document alignment: maps old array positions to new ones.
	const oldToNew = alignCellSequences(previousCells, currentCells);

	const previousPositionById = new Map<string, number>();
	previousCells.forEach((cell, position) => previousPositionById.set(cell.id, position));

	const results: (CellReconciliation | undefined)[] = new Array(associations.length);
	const claimedNewPositions = new Set<number>();
	const orphanedPositions: number[] = [];
	const fallbackPositions: number[] = [];

	// Aligned path: follow the alignment where possible; the rest are
	// tentatively orphaned.
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

	// Pairing pass: each unmatched association claims an unclaimed current
	// cell with the same content hash, in previous-position order so
	// duplicate-hash pairings are deterministic.
	const unclaimedByHash = new Map<string, number[]>();
	currentCells.forEach((cell, position) => {
		if (claimedNewPositions.has(position)) {
			return;
		}
		const candidates = unclaimedByHash.get(cell.contentHash);
		if (candidates) {
			candidates.push(position);
		} else {
			unclaimedByHash.set(cell.contentHash, [position]);
		}
	});
	const orphansByPreviousPosition = [...orphanedPositions].sort((a, b) =>
		previousPositionById.get(associations[a].id)! - previousPositionById.get(associations[b].id)!);
	for (const position of orphansByPreviousPosition) {
		const association = associations[position];
		const candidates = unclaimedByHash.get(association.contentHash);
		const newPosition = candidates?.shift();
		if (newPosition === undefined) {
			continue;
		}
		claimedNewPositions.add(newPosition);
		results[position] = { kind: 'moved', oldId: association.id, newCell: currentCells[newPosition] };
	}

	// Fallback path: associations with no previous-cell entry match what
	// the pairing pass left unclaimed, in id-index order.
	const orderedFallbacks = [...fallbackPositions].sort((a, b) =>
		(parsePreviousIndex(associations[a].id) ?? 0) - (parsePreviousIndex(associations[b].id) ?? 0));
	for (const position of orderedFallbacks) {
		const association = associations[position];
		const candidates = unclaimedByHash.get(association.contentHash);
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
 * Maps previous-cell array positions to current ones via an LCS diff of
 * the content-hash sequences. Positions in changed regions have no entry.
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

/** The leading digits of a cell id are its index; `NaN` becomes "no preference". */
function parsePreviousIndex(id: string): number | undefined {
	const index = parseInt(id, 10);
	return Number.isNaN(index) ? undefined : index;
}
