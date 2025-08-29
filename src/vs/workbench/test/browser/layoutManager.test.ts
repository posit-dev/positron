/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { LayoutManager } from '../../browser/positronDataGrid/classes/layoutManager.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';

/**
 * Tests the LayoutManager class.
 */
suite('LayoutManager', () => {
	/**
	 * Tests size.
	 */
	test('Size', () => {
		verifySizeOfDefaultSizedEntries(1, 1);
		verifySizeOfDefaultSizedEntries(123, 100);
		verifySizeOfDefaultSizedEntries(4096, 5_000_000);

		verifySizeOfFixedSizedEntries(1, 1);
		verifySizeOfFixedSizedEntries(123, 100);
		verifySizeOfFixedSizedEntries(167, 20_000);

		verifySizeOfRandomlySizedEntries(1);
		verifySizeOfRandomlySizedEntries(100);
		verifySizeOfRandomlySizedEntries(20_000);
	});

	/**
	 * Tests getting a layout entry.
	 */
	test('Get Layout Entry', () => {
		verifyGetLayoutEntryOfDefaultSizedEntries(1, 1);
		verifyGetLayoutEntryOfDefaultSizedEntries(123, 100);
		verifyGetLayoutEntryOfDefaultSizedEntries(4096, 5_000_000);

		verifyGetLayoutEntryOfFixedSizedEntries(1, 1);
		verifyGetLayoutEntryOfFixedSizedEntries(123, 100);
		verifyGetLayoutEntryOfFixedSizedEntries(167, 20_000);

		verifyGetLayoutEntryOfRandomlySizedEntries(1);
		verifyGetLayoutEntryOfRandomlySizedEntries(100);
		verifyGetLayoutEntryOfRandomlySizedEntries(20_000);
	});

	/**
	 * Tests default-sized entries.
	 */
	test('Default-Sized Entries', () => {
		verifyDefaultSizedEntries(1, 2);
		verifyDefaultSizedEntries(10, 10);
		verifyDefaultSizedEntries(1, 1_000);
		verifyDefaultSizedEntries(19, 1_000);
		verifyDefaultSizedEntries(127, 20_000);
		// Too big for CI.
		// verifyDefaultSizedEntries(23, 500_000);
	});

	/**
	 * Tests default-sized entries with overrides.
	 */
	test('Default-Sized Entries With Overrides', () => {
		verifyDefaultSizedEntriesWithOverrides(127, 253, 20_000, 500);
		verifyDefaultSizedEntriesWithOverrides(200, 18, 50_000, 1_000);
		// Too big for CI.
		// verifyDefaultSizedEntriesWithOverrides(187, 392, 50_000_000, 10_000);
	});

	/**
	 * Tests fixed-sized predefined entries.
	 */
	test('Fixed-Sized Predefined Entries', () => {
		verifyFixedSizedPredefinedEntries(1, 1);
		verifyFixedSizedPredefinedEntries(10, 10);
		verifyFixedSizedPredefinedEntries(1, 1_000);
		verifyFixedSizedPredefinedEntries(19, 1_000);
		// Too big for CI.
		// verifyFixedSizedPredefinedEntries(127, 20_000);
		// verifyFixedSizedPredefinedEntries(23, 500_000);
	});

	/**
	 * Tests randomly-sized predefined entries.
	 */
	test('Randomly-Sized Predefined Entries', () => {
		verifyRandomlySizedPredefinedEntries(1);
		verifyRandomlySizedPredefinedEntries(10);
		verifyRandomlySizedPredefinedEntries(100);
		// Too big for CI.
		//verifyRandomlySizedPredefinedEntries(1_000);
		//verifyRandomlySizedPredefinedEntries(20_000);
	});

	/**
	 * Tests mapping positions to indexes and indexes to positions with no entry map and no pinned indexes.
	 */
	test('Map Position To Index - Map Index To Position - No Entry Map - No Pinned Indexes', () => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(100);
		layoutManager.setEntries(10);

		// Test mapping positions to indexes.
		assert(layoutManager.mapPositionToIndex(-1) === undefined);
		assert(layoutManager.mapPositionToIndex(-10) === undefined);
		testMapPositionToIndex(layoutManager, 0, 0);
		testMapPositionToIndex(layoutManager, 1, 1);
		testMapPositionToIndex(layoutManager, 2, 2);
		testMapPositionToIndex(layoutManager, 3, 3);
		testMapPositionToIndex(layoutManager, 4, 4);
		testMapPositionToIndex(layoutManager, 5, 5);
		testMapPositionToIndex(layoutManager, 6, 6);
		testMapPositionToIndex(layoutManager, 7, 7);
		testMapPositionToIndex(layoutManager, 8, 8);
		testMapPositionToIndex(layoutManager, 9, 9);
		assert(layoutManager.mapPositionToIndex(10) === undefined);
		assert(layoutManager.mapPositionToIndex(100) === undefined);

		// Test mapping indexes to positions.
		assert(layoutManager.mapIndexToPosition(-1) === undefined);
		assert(layoutManager.mapIndexToPosition(-10) === undefined);
		testMapIndexToPosition(layoutManager, 0, 0);
		testMapIndexToPosition(layoutManager, 1, 1);
		testMapIndexToPosition(layoutManager, 2, 2);
		testMapIndexToPosition(layoutManager, 3, 3);
		testMapIndexToPosition(layoutManager, 4, 4);
		testMapIndexToPosition(layoutManager, 5, 5);
		testMapIndexToPosition(layoutManager, 6, 6);
		testMapIndexToPosition(layoutManager, 7, 7);
		testMapIndexToPosition(layoutManager, 8, 8);
		testMapIndexToPosition(layoutManager, 9, 9);
		assert(layoutManager.mapIndexToPosition(10) === undefined);
		assert(layoutManager.mapIndexToPosition(100) === undefined);
	});

	/**
	 * Tests mapping positions to indexes and indexes to positions with an entry map and no pinned indexes.
	 */
	test('Map Position To Index - Map Index To Position - With Entry Map - No Pinned Indexes', () => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(100);
		layoutManager.setEntries(10, undefined, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

		// Test mapping positions to indexes.
		assert(layoutManager.mapPositionToIndex(-1) === undefined);
		assert(layoutManager.mapPositionToIndex(-10) === undefined);
		testMapPositionToIndex(layoutManager, 0, 9);
		testMapPositionToIndex(layoutManager, 1, 8);
		testMapPositionToIndex(layoutManager, 2, 7);
		testMapPositionToIndex(layoutManager, 3, 6);
		testMapPositionToIndex(layoutManager, 4, 5);
		testMapPositionToIndex(layoutManager, 5, 4);
		testMapPositionToIndex(layoutManager, 6, 3);
		testMapPositionToIndex(layoutManager, 7, 2);
		testMapPositionToIndex(layoutManager, 8, 1);
		testMapPositionToIndex(layoutManager, 9, 0);
		assert(layoutManager.mapPositionToIndex(10) === undefined);
		assert(layoutManager.mapPositionToIndex(100) === undefined);

		// Test mapping indexes to positions.
		assert(layoutManager.mapIndexToPosition(-1) === undefined);
		assert(layoutManager.mapIndexToPosition(-10) === undefined);
		testMapIndexToPosition(layoutManager, 9, 0);
		testMapIndexToPosition(layoutManager, 8, 1);
		testMapIndexToPosition(layoutManager, 7, 2);
		testMapIndexToPosition(layoutManager, 6, 3);
		testMapIndexToPosition(layoutManager, 5, 4);
		testMapIndexToPosition(layoutManager, 4, 5);
		testMapIndexToPosition(layoutManager, 3, 6);
		testMapIndexToPosition(layoutManager, 2, 7);
		testMapIndexToPosition(layoutManager, 1, 8);
		testMapIndexToPosition(layoutManager, 0, 9);
		assert(layoutManager.mapIndexToPosition(10) === undefined);
		assert(layoutManager.mapIndexToPosition(100) === undefined);
	});

	/**
	 * Tests mapping positions to indexes and indexes to positions with an entry map and no pinned indexes.
	 */
	test('Map Position To Index - Map Index To Position - With No Entry Map - With Pinned Indexes', () => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(100);
		layoutManager.setEntries(10);
		layoutManager.setPinnedIndexes([3, 2, 0]);

		// Test mapping positions to indexes.
		assert(layoutManager.mapPositionToIndex(-1) === undefined);
		assert(layoutManager.mapPositionToIndex(-10) === undefined);
		testMapPositionToIndex(layoutManager, 0, 3);
		testMapPositionToIndex(layoutManager, 1, 2);
		testMapPositionToIndex(layoutManager, 2, 0);
		testMapPositionToIndex(layoutManager, 3, 1);
		testMapPositionToIndex(layoutManager, 4, 4);
		testMapPositionToIndex(layoutManager, 5, 5);
		testMapPositionToIndex(layoutManager, 6, 6);
		testMapPositionToIndex(layoutManager, 7, 7);
		testMapPositionToIndex(layoutManager, 8, 8);
		testMapPositionToIndex(layoutManager, 9, 9);
		assert(layoutManager.mapPositionToIndex(10) === undefined);
		assert(layoutManager.mapPositionToIndex(100) === undefined);

		// Test mapping indexes to positions.
		assert(layoutManager.mapIndexToPosition(-1) === undefined);
		assert(layoutManager.mapIndexToPosition(-10) === undefined);
		testMapIndexToPosition(layoutManager, 0, 2);
		testMapIndexToPosition(layoutManager, 1, 3);
		testMapIndexToPosition(layoutManager, 2, 1);
		testMapIndexToPosition(layoutManager, 3, 0);
		testMapIndexToPosition(layoutManager, 4, 4);
		testMapIndexToPosition(layoutManager, 5, 5);
		testMapIndexToPosition(layoutManager, 6, 6);
		testMapIndexToPosition(layoutManager, 7, 7);
		testMapIndexToPosition(layoutManager, 8, 8);
		testMapIndexToPosition(layoutManager, 9, 9);
		assert(layoutManager.mapIndexToPosition(10) === undefined);
		assert(layoutManager.mapIndexToPosition(100) === undefined);
	});

	/**
	 * Tests mapping positions to indexes and indexes to positions with an entry map and no pinned indexes.
	 */
	test('Map Position To Index - Map Index To Position - With Entry Map - With Pinned Indexes', () => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(100);
		layoutManager.setEntries(10, undefined, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
		layoutManager.setPinnedIndexes([3, 2, 0]);

		// Test mapping positions to indexes.
		assert(layoutManager.mapPositionToIndex(-1) === undefined);
		assert(layoutManager.mapPositionToIndex(-10) === undefined);
		testMapPositionToIndex(layoutManager, 0, 3);
		testMapPositionToIndex(layoutManager, 1, 2);
		testMapPositionToIndex(layoutManager, 2, 0);
		testMapPositionToIndex(layoutManager, 3, 9);
		testMapPositionToIndex(layoutManager, 4, 8);
		testMapPositionToIndex(layoutManager, 5, 7);
		testMapPositionToIndex(layoutManager, 6, 6);
		testMapPositionToIndex(layoutManager, 7, 5);
		testMapPositionToIndex(layoutManager, 8, 4);
		testMapPositionToIndex(layoutManager, 9, 1);
		assert(layoutManager.mapPositionToIndex(10) === undefined);
		assert(layoutManager.mapPositionToIndex(100) === undefined);

		// Test mapping indexes to positions.
		assert(layoutManager.mapIndexToPosition(-1) === undefined);
		assert(layoutManager.mapIndexToPosition(-10) === undefined);
		testMapIndexToPosition(layoutManager, 3, 0);
		testMapIndexToPosition(layoutManager, 2, 1);
		testMapIndexToPosition(layoutManager, 0, 2);
		testMapIndexToPosition(layoutManager, 9, 3);
		testMapIndexToPosition(layoutManager, 8, 4);
		testMapIndexToPosition(layoutManager, 7, 5);
		testMapIndexToPosition(layoutManager, 6, 6);
		testMapIndexToPosition(layoutManager, 5, 7);
		testMapIndexToPosition(layoutManager, 4, 8);
		testMapIndexToPosition(layoutManager, 1, 9);
		assert(layoutManager.mapIndexToPosition(10) === undefined);
		assert(layoutManager.mapIndexToPosition(100) === undefined);
	});

	/**
	 * Verify size for default-sized entries.
	 */
	const verifySizeOfDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setEntries(entries);
		const size = defaultSize * entries;

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setSizeOverride(0, defaultSize * 2);
		layoutManager.setSizeOverride(entries, defaultSize * 2);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size + defaultSize);

		// Get a layout entry cached, for coverage.
		layoutManager.findFirstUnpinnedLayoutEntry(0);

		// Clear layout overrides.
		layoutManager.clearSizeOverride(0);
		layoutManager.clearSizeOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);
	};

	/**
	 * Verify size for fixed-sized entries.
	 */
	const verifySizeOfFixedSizedEntries = (entrySize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(100);
		layoutManager.setEntries(entries, Array.from({ length: entries }, (_, i) => entrySize));
		const size = entrySize * entries;

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setSizeOverride(0, entrySize * 2);
		layoutManager.setSizeOverride(entries, entrySize * 2);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size + entrySize);

		// Clear layout overrides.
		layoutManager.clearSizeOverride(0);
		layoutManager.clearSizeOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);
	};

	/**
	 * Verify size for randomly-sized entries.
	 */
	const verifySizeOfRandomlySizedEntries = (entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(100);
		const entrySizes = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 400)
		);
		layoutManager.setEntries(entries, entrySizes);
		const size = entrySizes.reduce((size, randomSize) => size + randomSize, 0);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setSizeOverride(0, entrySizes[0] * 2);
		layoutManager.setSizeOverride(entries, 354);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size + entrySizes[0]);

		// Clear layout overrides.
		layoutManager.clearSizeOverride(0);
		layoutManager.clearSizeOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, size);
	};

	/**
	 * Verify getting a layout entry of default-sized entries.
	 * @param defaultSize
	 * @param entries
	 */
	const verifyGetLayoutEntryOfDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setEntries(entries);

		// Verify getting the first layout entry.
		let layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, defaultSize);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, (entries - 1) * defaultSize);
		assert.strictEqual(layoutEntry.size, defaultSize);

		// Add a layout override.
		layoutManager.setSizeOverride(0, defaultSize * 2);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, defaultSize * 2);

		// Verify getting the last layout entry.
		if (entries > 1) {
			layoutEntry = layoutManager.getLayoutEntry(entries - 1);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry.index, entries - 1);
			assert.strictEqual(layoutEntry.start, ((entries - 1) * defaultSize) + defaultSize);
			assert.strictEqual(layoutEntry.size, defaultSize);
		}

		// Clear the layout override.
		layoutManager.clearSizeOverride(0);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, defaultSize);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, (entries - 1) * defaultSize);
		assert.strictEqual(layoutEntry.size, defaultSize);
	};

	/**
	 * Verify getting a layout entry of fixed-sized entries.
	 * @param entrySize The entry size.
	 * @param entries The number of entries.
	 */
	const verifyGetLayoutEntryOfFixedSizedEntries = (entrySize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(entrySize);
		layoutManager.setEntries(entries, Array.from({ length: entries }, (_, i) => entrySize));

		// Verify getting the first layout entry.
		let layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySize);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, (entries - 1) * entrySize);
		assert.strictEqual(layoutEntry.size, entrySize);

		// Add a layout override.
		layoutManager.setSizeOverride(0, entrySize * 2);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySize * 2);

		// Verify getting the last layout entry.
		if (entries > 1) {
			layoutEntry = layoutManager.getLayoutEntry(entries - 1);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry.index, entries - 1);
			assert.strictEqual(layoutEntry.start, ((entries - 1) * entrySize) + entrySize);
			assert.strictEqual(layoutEntry.size, entrySize);
		}

		// Clear the layout override.
		layoutManager.clearSizeOverride(0);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySize);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, (entries - 1) * entrySize);
		assert.strictEqual(layoutEntry.size, entrySize);
	};

	/**
	 * Verify getting a layout entry of randomly-sized entries.
	 * @param defaultSize
	 * @param entries
	 */
	const verifyGetLayoutEntryOfRandomlySizedEntries = (entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(50);
		const entrySizes = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 400)
		);
		layoutManager.setEntries(entries, entrySizes);
		const size = entrySizes.reduce((size, randomSize) => size + randomSize, 0);

		// Verify getting the first layout entry.
		let layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySizes[0]);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, size - entrySizes[entries - 1]);
		assert.strictEqual(layoutEntry.size, entrySizes[entries - 1]);

		// Add a layout override.
		layoutManager.setSizeOverride(0, entrySizes[0] * 2);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySizes[0] * 2);

		// Verify getting the last layout entry.
		if (entries > 1) {
			layoutEntry = layoutManager.getLayoutEntry(entries - 1);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry.index, entries - 1);
			assert.strictEqual(layoutEntry.start, size + entrySizes[0] - entrySizes[entries - 1]);
			assert.strictEqual(layoutEntry.size, entrySizes[entries - 1]);
		}

		// Add a layout override.
		layoutManager.clearSizeOverride(0);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, entrySizes[0]);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, size - entrySizes[entries - 1]);
		assert.strictEqual(layoutEntry.size, entrySizes[entries - 1]);
	};

	/**
	 * Verify default-sized entries.
	 * @param defaultSize The default size of each entry.
	 * @param entries The number of entries.
	 */
	const verifyDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setEntries(entries);

		// Verify that every entry is correct.
		for (let entry = 0; entry < entries; entry++) {
			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < defaultSize; offset++) {
				const start = defaultSize * entry;
				const layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + defaultSize);
			}
		}

		// Verify entries that should not be found.
		verifyEntriesThatShouldNotBeFound(layoutManager, entries, defaultSize);
	};

	/**
	 * Verify default-sized entries with overrides.
	 * @param defaultSize The default size of each entry.
	 * @param overrideSize The override size.
	 * @param entries The number of entries.
	 * @param overrideEntries The number of override entries.
	 */
	const verifyDefaultSizedEntriesWithOverrides = (
		defaultSize: number,
		overrideSize: number,
		entries: number,
		overrideEntries: number
	) => {
		// Define parameters.
		const overridesStartAt = Math.floor(entries / 2);

		// Create the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setEntries(entries);

		// Add bogus layout overrides.
		layoutManager.setSizeOverride(100.1, 1);
		layoutManager.setSizeOverride(1, 100.1);
		layoutManager.setSizeOverride(-1, 1);
		layoutManager.setSizeOverride(1, -1);

		// Add the layout overrides in reverse order for better coverage.
		for (let i = overrideEntries - 1; i >= 0; i--) {
			layoutManager.setSizeOverride(overridesStartAt + i, overrideSize);
		}

		// Add a layout override beyond the end for coverage.
		layoutManager.setSizeOverride(entries, overrideSize);

		// Add and remove a layout override.
		layoutManager.setSizeOverride(1, 1);
		layoutManager.clearSizeOverride(1);

		/**
		 * Verifies a layout entry before the overrides.
		 * @param index The index of the layout entry to verify.
		 */
		const verifyLayoutEntryBeforeOverrides = (index: number) => {
			// Assert that the index is within the range.
			assert(index < overridesStartAt);

			// Verify the layout entry.
			let layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(defaultSize * index);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, defaultSize * index);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(
				(defaultSize * index) + Math.floor(defaultSize / 2)
			);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, defaultSize * index);
			assert.strictEqual(layoutEntry!.size, defaultSize);
		};

		// Verify a subset of the layout entries before the overrides.
		verifyLayoutEntryBeforeOverrides(0);
		for (let i = 0; i < 100; i++) {
			verifyLayoutEntryBeforeOverrides(getRandomIntInclusive(1, overridesStartAt - 2));
		}
		verifyLayoutEntryBeforeOverrides(overridesStartAt - 1);

		/**
		 * Verifies a layout entry in the overrides.
		 * @param testIndex The test index.
		 */
		let startingOffset = defaultSize * overridesStartAt;
		const verifyLayoutEntryInOverrides = (testIndex: number) => {
			// Calculate the index.
			const index = testIndex + overridesStartAt;

			// Assert that the index is within the range.
			assert(index >= overridesStartAt);
			assert(index < overridesStartAt + overrideEntries);

			// Verify the layout entry.
			const start = startingOffset + (testIndex * overrideSize);
			let layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, overrideSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + Math.floor(overrideSize / 2));
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, overrideSize);
		};

		// Verify a subset of the layout entries in the overrides.
		verifyLayoutEntryInOverrides(0);
		for (let i = 0; i < 100; i++) {
			verifyLayoutEntryInOverrides(getRandomIntInclusive(1, overrideEntries - 2));
		}
		verifyLayoutEntryInOverrides(overrideEntries - 1);

		/**
		 * Verifies a layout entry after the overrides.
		 * @param index The index of the layout entry to verify.
		 */
		startingOffset += overrideEntries * overrideSize;
		const verifyLayoutEntryAfterOverrides = (testIndex: number) => {
			// Calculate the index.
			const index = testIndex + overridesStartAt + overrideEntries;

			// Assert that the index is within the range.
			assert(index >= overridesStartAt + overrideEntries);
			assert(index < entries);

			// Verify the layout entry.
			const start = startingOffset + (defaultSize * testIndex);
			let layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + Math.floor(defaultSize / 2));
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, defaultSize);
		};

		// Verify a random subset of the layout entries after the overrides.
		verifyLayoutEntryAfterOverrides(0);
		for (let i = 0; i < 100; i++) {
			verifyLayoutEntryAfterOverrides(
				getRandomIntInclusive(1, entries - overridesStartAt - overrideEntries - 2)
			);
		}
		verifyLayoutEntryAfterOverrides(entries - overridesStartAt - overrideEntries - 1);

		// Verify finding a layout entry that should not be found.
		assert(!layoutManager.findFirstUnpinnedLayoutEntry(Number.MAX_SAFE_INTEGER));
		assert(!layoutManager.findFirstUnpinnedLayoutEntry(Number.MIN_SAFE_INTEGER));

		// Verify getting the layout entry past the last index, for coverage.
		assert(!layoutManager.getLayoutEntry(entries));
	};

	/**
	 * Verify fixed-sized predefined entries.
	 * @param entrySize The size of each entry.
	 * @param entries The number of entries.
	 */
	const verifyFixedSizedPredefinedEntries = (entrySize: number, entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(entrySize);
		layoutManager.setEntries(entries, Array.from({ length: entries }, (_, i) => entrySize));

		// Verify that every entry is correct.
		for (let entry = 0; entry < entries; entry++) {
			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < entrySize; offset++) {
				const start = entry * entrySize;
				const layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + entrySize);
			}
		}

		// Verify getting various layout entries.
		assert(!layoutManager.getLayoutEntry(-1));
		assert(!layoutManager.getLayoutEntry(entries));
		assert.deepEqual(
			layoutManager.getLayoutEntry(0),
			{
				index: 0,
				start: 0,
				size: entrySize,
				end: entrySize
			}
		);
		assert.deepEqual(
			layoutManager.getLayoutEntry(entries - 1),
			{
				index: entries - 1,
				start: (entries - 1) * entrySize,
				size: entrySize,
				end: entries * entrySize
			}
		);

		// Override the first entry.
		const layoutOverride = Math.ceil(entrySize / 2);
		layoutManager.setSizeOverride(0, layoutOverride);

		// Verify entries that should not be found.
		verifyEntriesThatShouldNotBeFound(layoutManager, entries, entrySize);

		// Verify the size.
		assert.strictEqual(layoutManager.unpinnedLayoutEntriesSize, (entrySize * (entries - 1)) + layoutOverride);
	};

	/**
	 * Verify randomly-sized predefined entries.
	 * @param entries The number of entries.
	 */
	const verifyRandomlySizedPredefinedEntries = (entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(getRandomIntInclusive(20, 400));
		const entrySizes = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 400)
		);
		layoutManager.setEntries(entries, entrySizes);

		// Verify that every entry is correct.
		for (let entry = 0, start = 0; entry < entries; entry++) {
			// Get the size of the entry.
			const size = entrySizes[entry];

			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < size; offset++) {
				const layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + size);
			}

			// Adjust the start for the next entry.
			start += size;
		}

		// Override the first entry.
		layoutManager.setSizeOverride(0, 10);

		// Verify that every entry is correct.
		for (let entry = 0, start = 0; entry < entries; entry++) {
			// Get the size of the entry.
			const size = !entry ? 10 : entrySizes[entry];

			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < size; offset++) {
				const layoutEntry = layoutManager.findFirstUnpinnedLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + size);
			}

			// Adjust the start for the next entry.
			start += size;
		}
	};

	/**
	 * Verify entries that should not be found.
	 * @param layoutManager The layout manager.
	 * @param entries The number of entries.
	 * @param size The size of each entry.
	 */
	const verifyEntriesThatShouldNotBeFound = (
		layoutManager: LayoutManager,
		entries: number,
		size: number
	) => {
		// Verify that entries outside the range are not found.
		assert(!layoutManager.findFirstUnpinnedLayoutEntry(-1));
		assert(!layoutManager.findFirstUnpinnedLayoutEntry(entries * size));
		assert(!layoutManager.findFirstUnpinnedLayoutEntry((entries * size) + 100));
		assert(!layoutManager.findFirstUnpinnedLayoutEntry((entries * size) + 1000));
	};

	/**
	 * Gets a random integer in the inclusive range.
	 */
	const getRandomIntInclusive = (min: number, max: number) => {
		min = Math.ceil(min);
		max = Math.floor(max);
		return Math.floor(Math.random() * (max - min + 1)) + min;
	};

	/**
	 * Tests mapping a position to an index.
	 * @param layoutManager The layout manager.
	 * @param position The position to test.
	 * @param expectedIndex The expected index.
	 */
	const testMapPositionToIndex = (layoutManager: LayoutManager, position: number, expectedIndex: number) => {
		const index = layoutManager.mapPositionToIndex(position);
		assert(index !== undefined);
		assert.strictEqual(index, expectedIndex);
	};

	/**
	 * Tests mapping an index to a position.
	 * @param layoutManager The layout manager.
	 * @param index The index to test.
	 * @param expectedPosition The expected position.
	 */
	const testMapIndexToPosition = (layoutManager: LayoutManager, index: number, expectedPosition: number) => {
		const position = layoutManager.mapIndexToPosition(index);
		assert(position !== undefined);
		assert.strictEqual(position, expectedPosition);
	};

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
