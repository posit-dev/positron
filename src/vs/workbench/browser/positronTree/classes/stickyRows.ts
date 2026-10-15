/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VisibleNode } from './treeNode.js';
import { RowDescriptor } from '../../positronDataGrid/classes/dataGridInstance.js';

/**
 * The parent and subtree extent of each visible row, so that ancestors and subtrees are found
 * without scanning the rows.
 */
export interface RowStructure {
	/** The index of each row's parent, or -1 for a root. */
	readonly parents: Int32Array;
	/** The index just past each row's last descendant. */
	readonly ends: Int32Array;
}

/**
 * Computes the structure of a tree's visible rows.
 * @param rows The visible rows, in order.
 */
export function computeRowStructure(rows: readonly Pick<VisibleNode<unknown>, 'depth'>[]): RowStructure {
	const parents = new Int32Array(rows.length);
	const ends = new Int32Array(rows.length).fill(rows.length);
	const open: number[] = [];
	for (let i = 0; i < rows.length; i++) {
		while (open.length > 0 && rows[open[open.length - 1]].depth >= rows[i].depth) {
			ends[open.pop()!] = i;
		}
		parents[i] = open.length > 0 ? open[open.length - 1] : -1;
		open.push(i);
	}
	return { parents, ends };
}

/**
 * Computes the sticky rows of a tree: the expanded ancestors of the rows at the top of the
 * viewport, stacked by depth in a band at the top, like the editor's sticky scroll.
 *
 * Slot n of the band holds the ancestor at depth n of the row just below the band's first n
 * slots, as long as that ancestor has scrolled up past the slot and its subtree has not. When the
 * last ancestor's subtree ends inside its slot, the ancestor is pushed up by the overlap, so it
 * slides out of the band as its last descendant scrolls away.
 *
 * @param rows The visible rows, in order.
 * @param structure The structure of the rows.
 * @param rowTop Gets the top of the row at an index; at rows.length, the bottom of the last row.
 * @param scrollTop The vertical scroll offset.
 * @param rowHeight The height of a row in the band.
 * @param maxRows The most rows in the band.
 * @returns The sticky rows, with tops relative to the band.
 */
export function computeStickyRows(
	rows: readonly Pick<VisibleNode<unknown>, 'depth' | 'expandState'>[],
	structure: RowStructure,
	rowTop: (index: number) => number,
	scrollTop: number,
	rowHeight: number,
	maxRows: number
): RowDescriptor[] {
	const stickyRows: RowDescriptor[] = [];
	let subtreeBottom = 0;

	for (let slot = 0; slot < maxRows; slot++) {
		const slotTop = slot * rowHeight;
		const probeIndex = rowAt(rows.length, rowTop, scrollTop + slotTop);
		if (probeIndex >= rows.length) {
			break;
		}

		const ancestorIndex = ancestorAtDepth(rows, structure, probeIndex, slot);
		if (ancestorIndex === undefined || rows[ancestorIndex].expandState !== 'expanded') {
			break;
		}

		const ancestorTop = rowTop(ancestorIndex) - scrollTop;
		const bottom = rowTop(structure.ends[ancestorIndex]) - scrollTop;
		if (ancestorTop >= slotTop || bottom <= slotTop) {
			break;
		}

		stickyRows.push({ rowIndex: ancestorIndex, top: slotTop, height: rowHeight });
		subtreeBottom = bottom;
	}

	// Push the last row up by however much its subtree ends inside its slot.
	const last = stickyRows[stickyRows.length - 1];
	if (last && subtreeBottom < last.top + last.height) {
		stickyRows[stickyRows.length - 1] = { ...last, top: last.top + subtreeBottom - (last.top + last.height) };
	}

	return stickyRows;
}

/**
 * Finds the index of the row containing an offset, or the row count if the offset is past the rows.
 */
function rowAt(count: number, rowTop: (index: number) => number, offset: number): number {
	let low = 0;
	let high = count;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (rowTop(middle + 1) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/**
 * Finds the row at a depth that is the row at an index or one of its ancestors.
 */
function ancestorAtDepth(rows: readonly Pick<VisibleNode<unknown>, 'depth'>[], structure: RowStructure, index: number, depth: number): number | undefined {
	let i = index;
	while (i >= 0 && rows[i].depth > depth) {
		i = structure.parents[i];
	}
	return i >= 0 && rows[i].depth === depth ? i : undefined;
}
