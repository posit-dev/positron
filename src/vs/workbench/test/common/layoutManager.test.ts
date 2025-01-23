/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { LayoutManager } from '../../services/positronDataExplorer/common/layoutManager.js';

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
		verifyFixedSizedPredefinedEntries(127, 20_000);
		// Too big for CI.
		// verifyFixedSizedPredefinedEntries(23, 500_000);
	});

	/**
	 * Tests randomly-sized predefined entries.
	 */
	test('Randomly-Sized Predefined Entries', () => {
		verifyRandomlySizedPredefinedEntries(1);
		verifyRandomlySizedPredefinedEntries(10);
		verifyRandomlySizedPredefinedEntries(1_000);
		verifyRandomlySizedPredefinedEntries(20_000);
	});

	/**
	 * Verify size for default-sized entries.
	 */
	const verifySizeOfDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setLayoutEntries(entries);
		const size = defaultSize * entries;

		// Verify size.
		assert.strictEqual(layoutManager.size, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setLayoutOverride(0, defaultSize * 2);
		layoutManager.setLayoutOverride(entries, defaultSize * 2);

		// Verify size.
		assert.strictEqual(layoutManager.size, size + defaultSize);

		// Get a layout entry cached, for coverage.
		layoutManager.findLayoutEntry(0);

		// Clear layout overrides.
		layoutManager.clearLayoutOverride(0);
		layoutManager.clearLayoutOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.size, size);
	};

	/**
	 * Verify size for fixed-sized entries.
	 */
	const verifySizeOfFixedSizedEntries = (entrySize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(0);
		layoutManager.setLayoutEntries(Array.from({ length: entries }, (_, i) => entrySize));
		const size = entrySize * entries;

		// Verify size.
		assert.strictEqual(layoutManager.size, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setLayoutOverride(0, entrySize * 2);
		layoutManager.setLayoutOverride(entries, entrySize * 2);

		// Verify size.
		assert.strictEqual(layoutManager.size, size + entrySize);

		// Get a layout entry cached, for coverage.
		layoutManager.findLayoutEntry(0);

		// Clear layout overrides.
		layoutManager.clearLayoutOverride(0);
		layoutManager.clearLayoutOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.size, size);
	};

	/**
	 * Verify size for randomly-sized entries.
	 */
	const verifySizeOfRandomlySizedEntries = (entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(0);
		const layoutEntries = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 4096)
		);
		layoutManager.setLayoutEntries(layoutEntries);
		const size = layoutEntries.reduce((size, randomSize) => size + randomSize, 0);

		// Verify size.
		assert.strictEqual(layoutManager.size, size);

		// Add a layout override that will affect the size, and one that will not, for coverage.
		layoutManager.setLayoutOverride(0, layoutEntries[0] * 2);
		layoutManager.setLayoutOverride(entries, 354);

		// Verify size.
		assert.strictEqual(layoutManager.size, size + layoutEntries[0]);

		// Get a layout entry cached, for coverage.
		layoutManager.findLayoutEntry(0);

		// Clear layout overrides.
		layoutManager.clearLayoutOverride(0);
		layoutManager.clearLayoutOverride(entries);

		// Verify size.
		assert.strictEqual(layoutManager.size, size);
	};

	/**
	 * Verify getting a layout entry of default-sized entries.
	 * @param defaultSize
	 * @param entries
	 */
	const verifyGetLayoutEntryOfDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create and initialize the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setLayoutEntries(entries);

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
		layoutManager.setLayoutOverride(0, defaultSize * 2);

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
		layoutManager.clearLayoutOverride(0);

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
		const layoutManager = new LayoutManager(0);
		layoutManager.setLayoutEntries(Array.from({ length: entries }, (_, i) => entrySize));

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
		layoutManager.setLayoutOverride(0, entrySize * 2);

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
		layoutManager.clearLayoutOverride(0);

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
		const layoutManager = new LayoutManager(0);
		const layoutEntries = Array.from({ length: entries }, (_, i) =>
			getRandomIntInclusive(1, 4096)
		);
		layoutManager.setLayoutEntries(layoutEntries);
		const size = layoutEntries.reduce((size, randomSize) => size + randomSize, 0);

		// Verify getting the first layout entry.
		let layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, layoutEntries[0]);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, size - layoutEntries[entries - 1]);
		assert.strictEqual(layoutEntry.size, layoutEntries[entries - 1]);

		// Add a layout override.
		layoutManager.setLayoutOverride(0, layoutEntries[0] * 2);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, layoutEntries[0] * 2);

		// Verify getting the last layout entry.
		if (entries > 1) {
			layoutEntry = layoutManager.getLayoutEntry(entries - 1);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry.index, entries - 1);
			assert.strictEqual(layoutEntry.start, size + layoutEntries[0] - layoutEntries[entries - 1]);
			assert.strictEqual(layoutEntry.size, layoutEntries[entries - 1]);
		}

		// Add a layout override.
		layoutManager.clearLayoutOverride(0);

		// Verify getting the first layout entry.
		layoutEntry = layoutManager.getLayoutEntry(0);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, 0);
		assert.strictEqual(layoutEntry.start, 0);
		assert.strictEqual(layoutEntry.size, layoutEntries[0]);

		// Verify getting the last layout entry.
		layoutEntry = layoutManager.getLayoutEntry(entries - 1);
		assert(layoutEntry);
		assert.strictEqual(layoutEntry.index, entries - 1);
		assert.strictEqual(layoutEntry.start, size - layoutEntries[entries - 1]);
		assert.strictEqual(layoutEntry.size, layoutEntries[entries - 1]);
	};

	/**
	 * Verify default-sized entries.
	 * @param defaultSize The default size of each entry.
	 * @param entries The number of entries.
	 */
	const verifyDefaultSizedEntries = (defaultSize: number, entries: number) => {
		// Create the layout manager.
		const layoutManager = new LayoutManager(defaultSize);
		layoutManager.setLayoutEntries(entries);

		// Verify that every entry is correct.
		for (let entry = 0; entry < entries; entry++) {
			// Verify that every offset for every entry is correct.
			for (let offset = 0; offset < defaultSize; offset++) {
				const start = defaultSize * entry;
				const layoutEntry = layoutManager.findLayoutEntry(start + offset);
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
		layoutManager.setLayoutEntries(entries);

		// Add bogus layout overrides.
		layoutManager.setLayoutOverride(100.1, 1);
		layoutManager.setLayoutOverride(1, 100.1);
		layoutManager.setLayoutOverride(-1, 1);
		layoutManager.setLayoutOverride(1, -1);

		// Add the layout overrides in reverse order for better coverage.
		for (let i = overrideEntries - 1; i >= 0; i--) {
			layoutManager.setLayoutOverride(overridesStartAt + i, overrideSize);
		}

		// Add a layout override beyond the end for coverage.
		layoutManager.setLayoutOverride(entries, overrideSize);

		// Add and remove a layout override.
		layoutManager.setLayoutOverride(1, 1);
		layoutManager.clearLayoutOverride(1);

		/**
		 * Verifies a layout entry before the overrides.
		 * @param index The index of the layout entry to verify.
		 */
		const verifyLayoutEntryBeforeOverrides = (index: number) => {
			// Assert that the index is within the range.
			assert(index < overridesStartAt);

			// Verify the layout entry.
			let layoutEntry = layoutManager.findLayoutEntry(defaultSize * index);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, defaultSize * index);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(
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
			let layoutEntry = layoutManager.findLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, overrideSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(start + Math.floor(overrideSize / 2));
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
			let layoutEntry = layoutManager.findLayoutEntry(start);
			assert(layoutEntry);
			assert.strictEqual(layoutEntry!.index, index);
			assert.strictEqual(layoutEntry!.start, start);
			assert.strictEqual(layoutEntry!.size, defaultSize);

			// Verify the layout entry.
			layoutEntry = layoutManager.findLayoutEntry(start + Math.floor(defaultSize / 2));
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
		assert(!layoutManager.findLayoutEntry(Number.MAX_SAFE_INTEGER));
		assert(!layoutManager.findLayoutEntry(Number.MIN_SAFE_INTEGER));

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

		// Verify getting various layout entries.
		assert(!layoutManager.getLayoutEntry(-1));
		assert(!layoutManager.getLayoutEntry(entries));
		assert.deepEqual(
			layoutManager.getLayoutEntry(0),
			{
				index: 0,
				start: 0,
				defaultSize: entrySize,
				overrideSize: undefined
			}
		);
		assert.deepEqual(
			layoutManager.getLayoutEntry(entries - 1),
			{
				index: entries - 1,
				start: (entries - 1) * entrySize,
				defaultSize: entrySize,
				overrideSize: undefined
			}
		);

		// Override the first entry.
		const layoutOverride = Math.ceil(entrySize / 2);
		layoutManager.setLayoutOverride(0, layoutOverride);

		// Verify entries that should not be found.
		verifyEntriesThatShouldNotBeFound(layoutManager, entries, entrySize);

		// Verify the size.
		assert.strictEqual(layoutManager.size, (entrySize * (entries - 1)) + layoutOverride);
	};

	/**
	 * Verify randomly-sized predefined entries.
	 * @param entries The number of entries.
	 */
	const verifyRandomlySizedPredefinedEntries = (entries: number) => {
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
		assert(!layoutManager.findLayoutEntry(-1));
		assert(!layoutManager.findLayoutEntry(entries * size));
		assert(!layoutManager.findLayoutEntry((entries * size) + 100));
		assert(!layoutManager.findLayoutEntry((entries * size) + 1000));
	};

	/**
	 * Gets a random integer in the inclusive range.
	 */
	const getRandomIntInclusive = (min: number, max: number) => {
		min = Math.ceil(min);
		max = Math.floor(max);
		return Math.floor(Math.random() * (max - min + 1)) + min;
	};

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
