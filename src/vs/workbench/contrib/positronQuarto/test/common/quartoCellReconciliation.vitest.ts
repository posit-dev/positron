/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { IQuartoCellSource, reconcileCellAssociations } from '../../common/quartoCellReconciliation.js';

function cell(index: number, contentHash: string): QuartoCodeCell {
	return {
		id: `${index}-${contentHash.substring(0, 8)}-unlabeled`,
		language: 'r',
		startLine: 1,
		endLine: 1,
		codeStartLine: 2,
		codeEndLine: 2,
		options: '',
		contentHash,
		index,
	};
}

function source(...cells: readonly QuartoCodeCell[]): IQuartoCellSource {
	return { cells };
}

describe('reconcileCellAssociations', () => {
	it('keeps an association on its own cell when nothing changed', () => {
		const model = source(cell(0, 'hash'));

		const [result] = reconcileCellAssociations(model, [cell(0, 'hash')], [
			{ id: '0-hash-unlabeled', contentHash: 'hash' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '0-hash-unlabeled', newCell: cell(0, 'hash') });
	});

	it('resolves a moved cell via content hash when no other cell shares it', () => {
		const model = source(cell(3, 'hash'));

		const [result] = reconcileCellAssociations(model, [cell(2, 'hash')], [
			{ id: '2-hash-unlabeled', contentHash: 'hash' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '2-hash-unlabeled', newCell: cell(3, 'hash') });
	});

	it('orphans an association whose content hash matches no current cell', () => {
		const model = source(cell(0, 'other'));

		const [result] = reconcileCellAssociations(model, [cell(0, 'hash')], [
			{ id: '0-hash-unlabeled', contentHash: 'hash' },
		]);

		expect(result).toEqual({ kind: 'orphaned', id: '0-hash-unlabeled' });
	});

	it('pairs several stale associations sharing a content hash with current cells in index order', () => {
		// Insert a distinct cell before two identical unlabeled cells. Both
		// duplicates shift down by one, and the second duplicate's *old* id
		// now happens to equal the *first* duplicate's *new* id. An
		// id-equality check alone would wrongly treat the second association
		// as still valid, bound to the first duplicate's cell, leaving the
		// first association nothing to resolve to but a false "orphaned".
		// Both were fully tracked before the edit, so the previous cell list
		// already reflects their true relative order.
		const previousCells = [cell(0, 'dup'), cell(1, 'dup')];
		const model = source(cell(0, 'distinct'), cell(1, 'dup'), cell(2, 'dup'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-dup-unlabeled', contentHash: 'dup' },
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-dup-unlabeled', newCell: cell(1, 'dup') },
			{ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(2, 'dup') },
		]);
	});

	it('orphans the excess association when fewer current cells share a hash than associations do', () => {
		// Three duplicate-content associations, but one of the three cells was
		// genuinely deleted: only two candidates remain for three claimants.
		const previousCells = [cell(0, 'dup'), cell(1, 'dup'), cell(2, 'dup')];
		const model = source(cell(0, 'dup'), cell(1, 'dup'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-dup-unlabeled', contentHash: 'dup' },
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
			{ id: '2-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-dup-unlabeled', newCell: cell(0, 'dup') },
			{ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(1, 'dup') },
			{ kind: 'orphaned', id: '2-dup-unlabeled' },
		]);
	});

	it('uses the previous cell list to rank a sparsely-tracked association among untracked siblings', () => {
		// Only the SECOND of two identical cells has an association (e.g. only
		// it ever produced output); the first was never tracked. Insert a
		// distinct cell above both. Ranking the lone association among only
		// the *tracked* siblings would treat it as rank 0 and wrongly resolve
		// it to the first duplicate's new position. The previous cell list
		// (which includes the untracked first duplicate) reveals its true
		// rank is 1, resolving it to the second duplicate's new position.
		const previousCells = [cell(0, 'dup'), cell(1, 'dup')]; // both existed; only index 1 was tracked
		const model = source(cell(0, 'distinct'), cell(1, 'dup'), cell(2, 'dup'));

		const [result] = reconcileCellAssociations(model, previousCells, [
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(2, 'dup') });
	});

	it('keeps a surviving duplicate\'s association when its twin is edited', () => {
		// Two identical cells, only the second tracked. Editing the FIRST
		// cell shrinks the hash group to one candidate; matching that ranks
		// associations within the group would read the survivor's stale rank
		// (1) as out of bounds and orphan it, dropping its output, even
		// though the tracked cell itself never changed.
		const previousCells = [cell(0, 'dup'), cell(1, 'dup')];
		const model = source(cell(0, 'edited'), cell(1, 'dup'));

		const [result] = reconcileCellAssociations(model, previousCells, [
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(1, 'dup') });
	});

	it('keeps a surviving duplicate\'s association when its twin is deleted', () => {
		// Same scenario, but the first cell is deleted outright. The diff
		// cannot tell which identical twin vanished, so it aligns the
		// untracked first cell onto the survivor; the tracked association
		// inherits that cell rather than being orphaned and losing its
		// output.
		const previousCells = [cell(0, 'dup'), cell(1, 'dup')];
		const model = source(cell(0, 'dup'));

		const [result] = reconcileCellAssociations(model, previousCells, [
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(0, 'dup') });
	});

	it('tracks cells across edits in disjoint regions of the same parse', () => {
		// An edit near the top and a deletion near the bottom landing in one
		// parse (a multi-cell paste, an undo of a multi-part edit). Matching
		// in from both ends only would widen the whole middle into one
		// changed region and orphan everything in it.
		const previousCells = [cell(0, 'a'), cell(1, 'dup'), cell(2, 'dup'), cell(3, 'b')];
		const model = source(cell(0, 'a2'), cell(1, 'dup'), cell(2, 'dup'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '1-dup-unlabeled', contentHash: 'dup' },
			{ id: '2-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '1-dup-unlabeled', newCell: cell(1, 'dup') },
			{ kind: 'moved', oldId: '2-dup-unlabeled', newCell: cell(2, 'dup') },
		]);
	});

	it('keeps associations on reordered cells with unique content', () => {
		// Reordering looks like deletion plus insertion to the diff: the
		// moved cell's hash still exists, just at a new position, so its
		// association must follow it rather than being orphaned.
		const previousCells = [cell(0, 'a'), cell(1, 'b'), cell(2, 'c')];
		const model = source(cell(0, 'b'), cell(1, 'c'), cell(2, 'a'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-a-unlabeled', contentHash: 'a' },
			{ id: '1-b-unlabeled', contentHash: 'b' },
			{ id: '2-c-unlabeled', contentHash: 'c' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-a-unlabeled', newCell: cell(2, 'a') },
			{ kind: 'moved', oldId: '1-b-unlabeled', newCell: cell(0, 'b') },
			{ kind: 'moved', oldId: '2-c-unlabeled', newCell: cell(1, 'c') },
		]);
	});

	it('keeps associations through a two-cell swap', () => {
		const previousCells = [cell(0, 'a'), cell(1, 'b')];
		const model = source(cell(0, 'b'), cell(1, 'a'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-a-unlabeled', contentHash: 'a' },
			{ id: '1-b-unlabeled', contentHash: 'b' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-a-unlabeled', newCell: cell(1, 'a') },
			{ kind: 'moved', oldId: '1-b-unlabeled', newCell: cell(0, 'b') },
		]);
	});

	it('orphans a deleted cell while tracking a moved one in the same parse', () => {
		const previousCells = [cell(0, 'a'), cell(1, 'b'), cell(2, 'c')];
		const model = source(cell(0, 'c'), cell(1, 'a'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-a-unlabeled', contentHash: 'a' },
			{ id: '1-b-unlabeled', contentHash: 'b' },
			{ id: '2-c-unlabeled', contentHash: 'c' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-a-unlabeled', newCell: cell(1, 'a') },
			{ kind: 'orphaned', id: '1-b-unlabeled' },
			{ kind: 'moved', oldId: '2-c-unlabeled', newCell: cell(0, 'c') },
		]);
	});

	it('keeps an association on a non-adjacent identical cell when its own cell is deleted', () => {
		// The surviving duplicate is not contiguous with the tracked one in
		// the previous cell list, and the diff aligns it with the untracked
		// first duplicate -- but the tracked association should still
		// inherit it rather than lose its output.
		const previousCells = [cell(0, 'dup'), cell(1, 'middle'), cell(2, 'dup')];
		const model = source(cell(0, 'dup'));

		const [result] = reconcileCellAssociations(model, previousCells, [
			{ id: '2-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '2-dup-unlabeled', newCell: cell(0, 'dup') });
	});

	it('transfers an association to a distant identical survivor when the tracked cell is deleted', () => {
		// Only the trailing duplicate was tracked; deleting it leaves the
		// untracked leading duplicate. Identical content makes the survivor
		// an equally good home for the association (the on-disk output
		// cache is keyed by content hash for the same reason).
		const previousCells = [cell(0, 'dup'), cell(1, 'middle'), cell(2, 'dup')];
		const model = source(cell(0, 'dup'), cell(1, 'middle'));

		const [result] = reconcileCellAssociations(model, previousCells, [
			{ id: '2-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '2-dup-unlabeled', newCell: cell(0, 'dup') });
	});

	it('still orphans a deleted duplicate when every identical survivor is itself tracked', () => {
		// One orphan is unavoidable here: a cell really did vanish, and the
		// survivor's own association already claims it.
		const previousCells = [cell(0, 'dup'), cell(1, 'middle'), cell(2, 'dup')];
		const model = source(cell(0, 'dup'), cell(1, 'middle'));

		const results = reconcileCellAssociations(model, previousCells, [
			{ id: '0-dup-unlabeled', contentHash: 'dup' },
			{ id: '2-dup-unlabeled', contentHash: 'dup' },
		]);

		expect(results).toEqual([
			{ kind: 'moved', oldId: '0-dup-unlabeled', newCell: cell(0, 'dup') },
			{ kind: 'orphaned', id: '2-dup-unlabeled' },
		]);
	});

	it('falls back to the id-embedded index when the association is not in the previous cell list', () => {
		// No previous-cell history yet (e.g. the very first reconciliation
		// pass) -- falls back to the index parsed from the id, same as before
		// previous-cell tracking existed.
		const model = source(cell(0, 'hash'));

		const [result] = reconcileCellAssociations(model, [], [
			{ id: '2-hash-unlabeled', contentHash: 'hash' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: '2-hash-unlabeled', newCell: cell(0, 'hash') });
	});

	it('does not throw on an id with no parseable index, and still matches by hash alone', () => {
		const model = source(cell(0, 'hash'));

		const [result] = reconcileCellAssociations(model, [], [
			{ id: 'not-a-valid-id', contentHash: 'hash' },
		]);

		expect(result).toEqual({ kind: 'moved', oldId: 'not-a-valid-id', newCell: cell(0, 'hash') });
	});
});
