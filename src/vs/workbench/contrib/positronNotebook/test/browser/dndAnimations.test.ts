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

	test('original-position drag closes gap when selected cells are above primary', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag contiguous selection [b, c] using c's handle at original slot.
		// This keeps insertionIndex at 3 (after the selected block).
		const transforms = calculateMultiSortingTransforms(items, rects, ['c', 'b'], 3);

		const aboveIndicator = transforms.get('b');
		const shiftedAboveNeighbor = transforms.get('a');

		assert.ok(aboveIndicator);
		assert.ok(shiftedAboveNeighbor);

		const primaryTop = rects.get('c')!.top + (transforms.get('c')?.y ?? 0);
		const primaryBottom = primaryTop + rects.get('c')!.height;
		const aboveNeighborBottom = rects.get('a')!.top + shiftedAboveNeighbor!.y + rects.get('a')!.height;
		const aboveIndicatorTop = rects.get('b')!.top + aboveIndicator!.y;
		const belowNeighborTop = rects.get('d')!.top + (transforms.get('d')?.y ?? 0);

		// Keep normal inter-cell spacing above and below the primary cell.
		assert.strictEqual(primaryTop - aboveNeighborBottom, 30);
		assert.strictEqual(belowNeighborTop - primaryBottom, 30);

		// Collapsed "above" indicator should remain attached just above primary.
		assert.strictEqual(aboveIndicatorTop + 4, primaryTop);
	});

	test('original-position drag keeps equal spacing when primary has selected cells above and below', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag contiguous selection [b, c, d] using c's handle at original slot.
		// insertionIndex 4 means after the selected block.
		const transforms = calculateMultiSortingTransforms(items, rects, ['c', 'b', 'd'], 4);

		const aboveIndicator = transforms.get('b');
		const belowIndicator = transforms.get('d');
		const shiftedAboveNeighbor = transforms.get('a');
		const shiftedBelowNeighbor = transforms.get('e');

		assert.ok(aboveIndicator);
		assert.ok(belowIndicator);
		assert.ok(shiftedAboveNeighbor);
		assert.ok(shiftedBelowNeighbor);

		const primaryTop = rects.get('c')!.top + (transforms.get('c')?.y ?? 0);
		const primaryBottom = primaryTop + rects.get('c')!.height;
		const aboveNeighborBottom = rects.get('a')!.top + shiftedAboveNeighbor!.y + rects.get('a')!.height;
		const belowNeighborTop = rects.get('e')!.top + shiftedBelowNeighbor!.y;
		const aboveIndicatorTop = rects.get('b')!.top + aboveIndicator!.y;
		const belowIndicatorTop = rects.get('d')!.top + belowIndicator!.y;

		// Keep normal inter-cell spacing around primary while showing both indicators.
		assert.strictEqual(primaryTop - aboveNeighborBottom, 30);
		assert.strictEqual(belowNeighborTop - primaryBottom, 30);
		assert.strictEqual(aboveIndicatorTop + 4, primaryTop);
		assert.strictEqual(belowIndicatorTop, primaryBottom);
	});

	test('multi-drag UP: primary first selected maintains proper spacing', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag [b, c] with b as primary up to index 0.
		const transforms = calculateMultiSortingTransforms(items, rects, ['b', 'c'], 0);

		const primaryTop = rects.get('b')!.top + (transforms.get('b')?.y ?? 0);
		const primaryBottom = primaryTop + rects.get('b')!.height;
		const shiftedA = transforms.get('a');
		const secondaryC = transforms.get('c');
		const shiftedD = transforms.get('d');

		assert.ok(shiftedA);
		assert.ok(secondaryC);
		assert.ok(shiftedD);

		// Primary should move to position 0.
		assert.strictEqual(primaryTop, 0);

		// Secondary indicator should be directly below primary.
		const secondaryTop = rects.get('c')!.top + secondaryC!.y;
		assert.strictEqual(secondaryTop, primaryBottom);

		// 'a' shifted down, maintaining 30px gap from primary bottom.
		const aTop = rects.get('a')!.top + shiftedA!.y;
		assert.strictEqual(aTop - primaryBottom, 30);

		// Items after selection shifted up to close vacated space.
		const dTop = rects.get('d')!.top + shiftedD!.y;
		assert.strictEqual(dTop - (aTop + 100), 30);
	});

	test('multi-drag UP: primary not first selected shifts by indicator offset', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag [b, c] with c as primary up to index 0.
		const transforms = calculateMultiSortingTransforms(items, rects, ['c', 'b'], 0);

		const primaryTop = rects.get('c')!.top + (transforms.get('c')?.y ?? 0);
		const indicatorB = transforms.get('b');

		assert.ok(indicatorB);

		// 'b' indicator should be above primary, offset by collapsedHeight (4px).
		const indicatorTop = rects.get('b')!.top + indicatorB!.y;
		assert.strictEqual(indicatorTop + 4, primaryTop);

		// Primary should be near position 0, offset by the indicator above it.
		assert.strictEqual(primaryTop, 4);
	});

	test('multi-drag UP: multiple selected cells above primary stack correctly', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Drag [b, c, d] with d as primary up to index 0.
		const transforms = calculateMultiSortingTransforms(items, rects, ['d', 'b', 'c'], 0);

		const primaryTop = rects.get('d')!.top + (transforms.get('d')?.y ?? 0);
		const indicatorB = transforms.get('b');
		const indicatorC = transforms.get('c');

		assert.ok(indicatorB);
		assert.ok(indicatorC);

		const bTop = rects.get('b')!.top + indicatorB!.y;
		const cTop = rects.get('c')!.top + indicatorC!.y;

		// Closest indicator (c) should be at primaryTop - collapsedHeight.
		assert.strictEqual(cTop + 4, primaryTop);

		// Next indicator (b) should be stackStride (2px) above c.
		assert.strictEqual(bTop, cTop - 2);

		// Both indicators above primary.
		assert.ok(bTop < primaryTop);
		assert.ok(cTop < primaryTop);
	});

	test('original-position at firstActiveIndex produces same result as lastActiveIndex+1', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Both insertion indices are "original position" for [b, c].
		const atFirst = calculateMultiSortingTransforms(items, rects, ['b', 'c'], 1);
		const atLast = calculateMultiSortingTransforms(items, rects, ['b', 'c'], 3);

		// Both should produce identical transforms for all items.
		for (const id of items) {
			const first = atFirst.get(id);
			const last = atLast.get(id);
			assert.deepStrictEqual(first, last, `Transform mismatch for '${id}'`);
		}
	});

	test('non-contiguous selection at original position does not close gaps', () => {
		const items = ['a', 'b', 'c', 'd', 'e'];
		const rects = new Map<string, DOMRect>([
			['a', rect(0)],
			['b', rect(130)],
			['c', rect(260)],
			['d', rect(390)],
			['e', rect(520)],
		]);

		// Non-contiguous: b (index 1) and d (index 3) selected, gap at c.
		const transforms = calculateMultiSortingTransforms(items, rects, ['b', 'd'], 1);

		// Non-active items should NOT shift because gap closure
		// only applies to contiguous selections.
		assert.strictEqual(transforms.get('a'), undefined);
		assert.strictEqual(transforms.get('c'), undefined);
		assert.strictEqual(transforms.get('e'), undefined);

		// 'd' should only have indicator transform (collapsed to thin line near primary).
		const dTransform = transforms.get('d');
		assert.ok(dTransform);
		assert.ok(dTransform!.scaleY !== undefined && dTransform!.scaleY < 1);
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
