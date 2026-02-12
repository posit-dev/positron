/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { calculateMultiSortingTransforms } from '../../browser/dnd/animations.js';

suite('Positron Notebook DnD Animations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function rect(top: number, height: number = 100): DOMRect {
		return new DOMRect(0, top, 100, height);
	}

	test('keeps the primary cell anchored when dragged cell is not first selected', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag two selected cells [b, c], but c is the primary dragged cell.
		// Insert before e (insertionIndex 4).
		const transforms = calculateMultiSortingTransforms(items, rects, ['c', 'b'], 4);

		const primary = transforms.get('c');
		assert.ok(primary);
		const primaryTop = rects.get('c')!.top + primary!.y;

		// Primary should stay near its pointer position and only shift by the collapsed
		// secondary indicator amount, not by the full height of the selected cell above.
		assert.strictEqual(primaryTop, 264);
	});

	test('secondary indicators do not increase displacement size', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag contiguous selection [b, c] with b as primary down before e.
		const transforms = calculateMultiSortingTransforms(items, rects, ['b', 'c'], 4);

		const primary = transforms.get('b');
		const secondary = transforms.get('c');
		const afterInsertion = transforms.get('e');

		assert.ok(primary);
		assert.ok(secondary);
		assert.ok(afterInsertion);

		const primaryTop = rects.get('b')!.top + primary!.y;
		const primaryBottom = primaryTop + rects.get('b')!.height;
		const secondaryTop = rects.get('c')!.top + secondary!.y;
		const nextCellTop = rects.get('e')!.top + afterInsertion!.y;

		// Secondary indicator should still be visible directly after primary.
		assert.strictEqual(secondaryTop, primaryBottom);

		// Displacement should match single-cell behavior (primary slot only):
		// primary bottom to next cell top should keep the normal 30px gap.
		assert.strictEqual(nextCellTop - primaryBottom, 30);
	});

	test('original-position drag keeps equal spacing around primary for contiguous selection', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag contiguous selection [b, c] using b's handle without crossing insertion threshold.
		// insertionIndex 3 is the original slot (after the selected block).
		const transforms = calculateMultiSortingTransforms(items, rects, ['b', 'c'], 3);

		const secondary = transforms.get('c');
		const belowPrimary = transforms.get('d');

		assert.ok(secondary);
		assert.ok(belowPrimary);

		const primaryTop = rects.get('b')!.top + (transforms.get('b')?.y ?? 0);
		const primaryBottom = primaryTop + rects.get('b')!.height;
		const aboveCellBottom = rects.get('a')!.top + rects.get('a')!.height;
		const secondaryTop = rects.get('c')!.top + secondary!.y;
		const nextCellTop = rects.get('d')!.top + belowPrimary!.y;

		// Keep normal inter-cell spacing above and below the primary cell.
		assert.strictEqual(primaryTop - aboveCellBottom, 30);
		assert.strictEqual(nextCellTop - primaryBottom, 30);

		// Secondary indicator should remain attached just below primary.
		assert.strictEqual(secondaryTop, primaryBottom);
	});

	test('large indicator stacks stay within surrounding gap space', () => {
		const items = Array.from({ length: 15 }, (_, i) => `i${i}`);
		const rects = new Map<string, DOMRect>();
		for (let i = 0; i < items.length; i++) {
			rects.set(items[i], rect(i * 130));
		}

		// Drag a large contiguous selection where many selected cells are above primary.
		const activeIds = ['i12', ...items.slice(1, 12)];
		const transforms = calculateMultiSortingTransforms(items, rects, activeIds, 14);

		const primary = transforms.get('i12');
		assert.ok(primary);
		const primaryTop = rects.get('i12')!.top + primary!.y;

		const aboveIndicators = items.slice(1, 12).map(id => {
			const tr = transforms.get(id);
			assert.ok(tr);
			const top = rects.get(id)!.top + tr!.y;
			return { id, top };
		});

		const highestIndicatorTop = Math.min(...aboveIndicators.map(i => i.top));
		const aboveNeighborId = 'i13';
		const aboveNeighborTransform = transforms.get(aboveNeighborId);
		const aboveNeighborTop = rects.get(aboveNeighborId)!.top + (aboveNeighborTransform?.y ?? 0);
		const aboveNeighborBottom = aboveNeighborTop + rects.get(aboveNeighborId)!.height;

		// Indicators should stay in inter-cell spacing and not overlap the cell above primary.
		assert.ok(highestIndicatorTop >= aboveNeighborBottom);
		assert.ok(highestIndicatorTop <= primaryTop);
	});
});
