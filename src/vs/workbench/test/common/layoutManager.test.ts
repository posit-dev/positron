/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { LayoutManager } from 'vs/workbench/services/positronDataExplorer/common/layoutManager';

/**
 * Tests the LayoutManager class.
 */
suite('LayoutManager', () => {
	/**
	 * Tests default-sized entries.
	 */
	test('Default-Sized Entries', () => {
		testDefaultSizedEntries(1, 1);
		testDefaultSizedEntries(10, 10);
		testDefaultSizedEntries(1, 1_000);
		testDefaultSizedEntries(19, 1_000);
		testDefaultSizedEntries(127, 20_000);
		testDefaultSizedEntries(23, 500_000);
	});

	/**
	 * Tests default-sized entries with overrides.
	 */
	test('Default-Sized Entries With Overrides', () => {
		testDefaultSizedEntriesWithOverrides(127, 253, 20_000, 500);
		testDefaultSizedEntriesWithOverrides(200, 18, 50_000, 1_000);
		testDefaultSizedEntriesWithOverrides(187, 392, 50_000_000, 10_000);
	});

	/**
	 * Tests fixed-sized predefined entries.
	 */
	test('Fixed-Sized Predefined Entries', () => {
		testFixedSizedPredefinedEntries(1, 1);
		testFixedSizedPredefinedEntries(10, 10);
		testFixedSizedPredefinedEntries(1, 1_000);
		testFixedSizedPredefinedEntries(19, 1_000);
		testFixedSizedPredefinedEntries(127, 20_000);
		testFixedSizedPredefinedEntries(23, 500_000);
	});

	/**
	 * Tests randomly-sized predefined entries.
	 */
	test('Randomly-Sized Predefined Entries', () => {
		testRandomlySizedPredefinedEntries(1);
		testRandomlySizedPredefinedEntries(10);
		testRandomlySizedPredefinedEntries(1_000);
		testRandomlySizedPredefinedEntries(20_000);
		// testRandomlySizedPredefinedEntries(50_000);
	});

	/**
	 * Tests default-sized entries.
	 * @param defaultSize The default size of each entry.
	 * @param entries The number of entries.
	 */
	const testDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setLayoutEntries(entries);

		// Verify that every entry is correct.
		for (let entry = 0; entry < entries; entry++) {
			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < defaultSize; offset++) {
				const start = entry * defaultSize;
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + defaultSize);
			}
		}

		// Verify entries that should not be found.
		testEntriesThatShouldNotBeFound(layoutManager, entries, defaultSize);
	};

	/**
	 * Tests default-sized entries with overrides.
	 * @param defaultSize The default size of each entry.
	 * @param overrideSize The override size.
	 * @param entries The number of entries.
	 * @param overrideEntries The number of override entries.
	 */
	const testDefaultSizedEntriesWithOverrides = (
		defaultSize: number,
		overrideSize: number,
		entries: number,
		overrideEntries: number
	) => {
		// Define test parameters.
		const overridesStartAt = entries / 2;

		// Create the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setLayoutEntries(entries);

		// Add a bogus layout overrides for test coverage.
		layoutManager.setLayoutOverride(100.1, 1);
		layoutManager.setLayoutOverride(1, 100.1);
		layoutManager.setLayoutOverride(-1, 1);
		layoutManager.setLayoutOverride(1, -1);

		// Add the layout overrides in reverse order for better test coverage.
		for (let i = overrideEntries - 1; i >= 0; i--) {
			layoutManager.setLayoutOverride(overridesStartAt + i, overrideSize);
		}

		/**
		 * Checks a layout entry before the overrides.
		 * @param index The index of the layout entry to check.
		 */
		const checkLayoutEntryBeforeOverrides = (index: number) => {
			// Assert that the index is within the range.
			assert(index < overridesStartAt);

			// Check the layout entry.
			let layoutEntry = layoutManager.findLayoutEntry(index * defaultSize);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, index * defaultSize);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Check the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(
				(index * defaultSize) + Math.floor(defaultSize / 2)
			);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, index * defaultSize);
			assert.strictEqual(layoutEntry!.size, defaultSize);
		};

		// Verify a subset of the layout entries before the overrides.
		checkLayoutEntryBeforeOverrides(0);
		for (let i = 0; i < 100; i++) {
			checkLayoutEntryBeforeOverrides(getRandomIntInclusive(1, overridesStartAt - 2));
		}
		checkLayoutEntryBeforeOverrides(overridesStartAt - 1);

		/**
		 * Checks a layout entry in the overrides.
		 * @param testIndex The test index.
		 */
		let startingOffset = overridesStartAt * defaultSize;
		const checkLayoutEntryInOverrides = (testIndex: number) => {
			// Calculate the index.
			const index = testIndex + overridesStartAt;

			// Assert that the index is within the range.
			assert(index >= overridesStartAt);
			assert(index < overridesStartAt + overrideEntries);

			// Check the layout entry.
			const start = startingOffset + (testIndex * overrideSize);
			let layoutEntry = layoutManager.findLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, overrideSize);

			// Check the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(start + Math.floor(overrideSize / 2));
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, overrideSize);
		};

		// Verify a subset of the layout entries in the overrides.
		checkLayoutEntryInOverrides(0);
		for (let i = 0; i < 100; i++) {
			checkLayoutEntryInOverrides(getRandomIntInclusive(1, overrideEntries - 2));
		}
		checkLayoutEntryInOverrides(overrideEntries - 1);

		/**
		 * Checks a layout entry after the overrides.
		 * @param index The index of the layout entry to check.
		 */
		startingOffset += overrideEntries * overrideSize;
		const checkLayoutEntryAfterOverrides = (testIndex: number) => {
			// Calculate the index.
			const index = testIndex + overridesStartAt + overrideEntries;

			// Assert that the index is within the range.
			assert(index >= overridesStartAt + overrideEntries);
			assert(index < entries);

			// Check the layout entry.
			const start = startingOffset + (testIndex * defaultSize);
			let layoutEntry = layoutManager.findLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Check the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(start + Math.floor(defaultSize / 2));
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, defaultSize);
		};

		// Verify a random subset of the layout entries after the overrides.
		checkLayoutEntryAfterOverrides(0);
		for (let i = 0; i < 100; i++) {
			checkLayoutEntryAfterOverrides(
				getRandomIntInclusive(1, entries - overridesStartAt - overrideEntries - 2)
			);
		}
		checkLayoutEntryAfterOverrides(entries - overridesStartAt - overrideEntries - 1);

		assert(!layoutManager.findLayoutEntry(Number.MAX_SAFE_INTEGER));
	};

	/**
	 * Tests fixed-sized predefined entries.
	 * @param entrySize The size of each entry.
	 * @param entries The number of entries.
	 */
	const testFixedSizedPredefinedEntries = (entrySize: number, entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(0);
		layoutManager.setLayoutEntries(Array.from({ length: entries }, (_, i) => entrySize));

		// Verify that every entry is correct.
		for (let entry = 0; entry < entries; entry++) {
			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < entrySize; offset++) {
				const start = entry * entrySize;
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + entrySize);
			}
		}

		// Override the first entry.
		const layoutOverride = Math.ceil(entrySize / 2);
		layoutManager.setLayoutOverride(0, layoutOverride);

		// Verify that every entry is correct.
		for (let entry = 0, start = 0; entry < entries; entry++) {
			// Get the size of the entry.
			const size = !entry ? layoutOverride : entrySize;

			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < size; offset++) {
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + size);
			}

			// Adjust the start for the next entry.
			start += size;
		}

		// Verify entries that should not be found.
		testEntriesThatShouldNotBeFound(layoutManager, entries, entrySize);
	};

	/**
	 * Tests randomly-sized predefined entries.
	 * @param entries The number of entries.
	 */
	const testRandomlySizedPredefinedEntries = (entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(0);
		const layoutEntries = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 100)
		);
		layoutManager.setLayoutEntries(layoutEntries);

		// Verify that every entry is correct.
		for (let entry = 0, start = 0; entry < entries; entry++) {
			// Get the size of the entry.
			const size = layoutEntries[entry];

			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < size; offset++) {
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
				assert(layoutEntry);
				assert.strictEqual(layoutEntry!.index, entry);
				assert.strictEqual(layoutEntry!.start, start);
				assert.strictEqual(layoutEntry!.end, start + size);
			}

			// Adjust the start for the next entry.
			start += size;
		}

		// Override the first entry.
		layoutManager.setLayoutOverride(0, 10);

		// Verify that every entry is correct.
		for (let entry = 0, start = 0; entry < entries; entry++) {
			// Get the size of the entry.
			const size = !entry ? 10 : layoutEntries[entry];

			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < size; offset++) {
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
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
	 * Tests entries that should not be found.
	 * @param layoutManager The layout manager.
	 * @param entries The number of entries.
	 * @param size The size of each entry.
	 */
	const testEntriesThatShouldNotBeFound = (
		layoutManager: LayoutManager,
		entries: number,
		size: number
	) => {
		// Verify that entries outside the range are not found.
		assert(!layoutManager.findLayoutEntry(-1));
		assert(!layoutManager.findLayoutEntry(entries * size));
		assert(!layoutManager.findLayoutEntry((entries * size) + 100));
		assert(!layoutManager.findLayoutEntry((entries * size) + 1000));
	};

	/**
	 * Gets a random integer in the inclusive range.
	 */
	const getRandomIntInclusive = (min: number, max: number) => {
		const minCeiled = Math.ceil(min);
		const maxFloored = Math.floor(max);
		return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled);
	};

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
