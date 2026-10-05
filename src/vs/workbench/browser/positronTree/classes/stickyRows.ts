/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VisibleNode } from './treeNode.js';
import { RowDescriptor } from '../../positronDataGrid/classes/dataGridInstance.js';

/**
 * Computes the sticky rows of a tree: the expanded ancestors of the rows at the top of the
 * viewport, stacked by depth in a band at the top, like the editor's sticky scroll.
 *
 * Slot n of the band holds the ancestor at depth n of the row just below the band's first n
 * slots, as long as that ancestor has scrolled up past the slot and its subtree has not. When the
 * last ancestor's subtree ends inside its slot, the ancestor is pushed up by the overlap, so it
 * slides out of the band as its last descendant scrolls away.
 *
 * @param rows The visible rows, in order. Every row has the same height.
 * @param scrollTop The vertical scroll offset.
 * @param rowHeight The height of a row.
 * @param maxRows The most rows in the band.
 * @returns The sticky rows, with tops relative to the band.
 */
export function computeStickyRows(
	rows: readonly Pick<VisibleNode<unknown>, 'depth' | 'expandState'>[],
	scrollTop: number,
	rowHeight: number,
	maxRows: number
): RowDescriptor[] {
	const stickyRows: RowDescriptor[] = [];
	let subtreeBottom = 0;

	for (let slot = 0; slot < maxRows; slot++) {
		const slotTop = slot * rowHeight;
		const probeIndex = Math.floor((scrollTop + slotTop) / rowHeight);
		if (probeIndex >= rows.length) {
			break;
		}

		const ancestorIndex = ancestorAtDepth(rows, probeIndex, slot);
		if (ancestorIndex === undefined || rows[ancestorIndex].expandState !== 'expanded') {
			break;
		}

		const ancestorTop = ancestorIndex * rowHeight - scrollTop;
		const bottom = subtreeEnd(rows, ancestorIndex) * rowHeight - scrollTop;
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
 * Finds the row at a depth that is the row at an index or one of its ancestors.
 */
function ancestorAtDepth(rows: readonly Pick<VisibleNode<unknown>, 'depth'>[], index: number, depth: number): number | undefined {
	for (let i = index; i >= 0; i--) {
		if (rows[i].depth === depth) {
			return i;
		}
		if (rows[i].depth < depth) {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Finds the index just past the last descendant of the row at an index.
 */
function subtreeEnd(rows: readonly Pick<VisibleNode<unknown>, 'depth'>[], index: number): number {
	const depth = rows[index].depth;
	for (let i = index + 1; i < rows.length; i++) {
		if (rows[i].depth <= depth) {
			return i;
		}
	}
	return rows.length;
}
