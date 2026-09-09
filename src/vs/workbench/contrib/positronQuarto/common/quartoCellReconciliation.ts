/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

/**
 * Re-anchors associations to their current cells by content hash, since a
 * stale `id` resolving to *some* cell doesn't prove it resolves to the
 * *same* one: ids embed their index (`{index}-{hashPrefix}-{label}`), so
 * identical-content cells can swap which one an old id names across a shift.
 *
 * Within each content-hash group, current cells are ranked by index and
 * associations by how many same-hash siblings preceded them in
 * `previousCells` -- the full cell list from the last update, not just the
 * tracked ones, since tracking is sparse (only cells with a view zone or
 * toolbar get an association). Same-rank pairs match; an association past
 * the end of its group's current cells is `orphaned`. An id missing from
 * `previousCells` (no prior update yet) falls back to the index in its own
 * id instead of a true rank.
 *
 * Known limitation: rank is fixed from `previousCells` and reused as-is, so
 * if an earlier same-hash cell is itself added or removed (not just shifted)
 * between updates, every later association in that group can be misranked.
 * Fixing this needs a whole-document, anchor-aware alignment (using
 * non-duplicate neighbors to localize where a change happened) rather than
 * per-group ranking; accepted for now.
 */
export function reconcileCellAssociations(
	model: IQuartoCellSource,
	previousCells: readonly QuartoCodeCell[],
	associations: readonly ICellAssociation[],
): CellReconciliation[] {
	const previousCellsById = new Map<string, QuartoCodeCell>();
	for (const cell of previousCells) {
		previousCellsById.set(cell.id, cell);
	}

	const cellsByHash = new Map<string, QuartoCodeCell[]>();
	for (const cell of model.cells) {
		const group = cellsByHash.get(cell.contentHash);
		if (group) {
			group.push(cell);
		} else {
			cellsByHash.set(cell.contentHash, [cell]);
		}
	}

	interface GroupEntry {
		readonly position: number;
		readonly id: string;
		/** True rank among all same-hash siblings in `previousCells`, tracked or not; `undefined` if `id` isn't in `previousCells` at all. */
		readonly trueRank: number | undefined;
		/** Ordering fallback for when `trueRank` is unavailable: the index embedded in `id`, meaningful only relative to other associations in the same group. */
		readonly parsedIndex: number;
	}

	const results: CellReconciliation[] = new Array(associations.length);
	const groups = new Map<string, GroupEntry[]>();
	associations.forEach((association, position) => {
		const previousCell = previousCellsById.get(association.id);
		const entry: GroupEntry = {
			position,
			id: association.id,
			trueRank: previousCell ? countPrecedingSiblings(previousCells, previousCell) : undefined,
			parsedIndex: parsePreviousIndex(association.id) ?? 0,
		};
		const group = groups.get(association.contentHash);
		if (group) {
			group.push(entry);
		} else {
			groups.set(association.contentHash, [entry]);
		}
	});

	for (const [hash, group] of groups) {
		const candidates = cellsByHash.get(hash) ?? [];
		const allRanked = group.every(entry => entry.trueRank !== undefined);
		const ordered = allRanked
			? [...group].sort((a, b) => a.trueRank! - b.trueRank!)
			: [...group].sort((a, b) => a.parsedIndex - b.parsedIndex);
		ordered.forEach((entry, sequentialIndex) => {
			const candidateIndex = allRanked ? entry.trueRank! : sequentialIndex;
			const newCell = candidates[candidateIndex];
			results[entry.position] = newCell
				? { kind: 'moved', oldId: entry.id, newCell }
				: { kind: 'orphaned', id: entry.id };
		});
	}

	return results;
}

/**
 * How many cells sharing `previousCell`'s content hash preceded it in the
 * full previous parse -- its true position among same-content siblings,
 * regardless of which of them were tracked.
 */
function countPrecedingSiblings(previousCells: readonly QuartoCodeCell[], previousCell: QuartoCodeCell): number {
	let rank = 0;
	for (const cell of previousCells) {
		if (cell.contentHash === previousCell.contentHash && cell.index < previousCell.index) {
			rank++;
		}
	}
	return rank;
}

/** The leading digits of a cell id are its index; `NaN` becomes "no preference". */
function parsePreviousIndex(id: string): number | undefined {
	const index = parseInt(id, 10);
	return Number.isNaN(index) ? undefined : index;
}
