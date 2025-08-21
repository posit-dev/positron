/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LayoutManager is used to manage the layout of columns and rows in a Data Grid.
 *
 * In this code:
 * index       - Represents the index of a column or row.
 * start       - Represents the X or Y coordinate of a column or row.
 * size        - Represents the width or height of a column or row.
 * end         - Represents the X or Y coordinate of the end of a column or row
 * defaultSize - Represents the default width or height of a column or row.
 * customSize  - Represents the custom width or height of a column or row (as set by a user).
 */

/**
 * Maximum number of layout entries that supports advanced layout features. When this limit is
 * exceeded, layout manager falls back to a simplified layout strategy.
 */
export const MAX_ADVANCED_LAYOUT_ENTRY_COUNT = 10_000_000;

/**
 * ILayoutEntry interface.
 */
export interface ILayoutEntry {
	/**
	 * Gets the index.
	 */
	readonly index: number;

	/**
	 * Gets the start.
	 */
	readonly start: number;

	/**
	 * Gets the size.
	 */
	readonly size: number;

	/**
	 * Gets the end.
	 */
	readonly end: number;
}

/**
 * LayoutManager class.
 */
export class LayoutManager {
	//#region Private Properties

	/**
	 * Gets the default size.
	 */
	private readonly _defaultSize: number = 0;

	/**
	 * Gets or sets the entry count.
	 */
	private _entryCount: number = 0;

	/**
	 * Gets or sets the entry sizes.
	 */
	private readonly _entrySizes = new Map<number, number>();

	/**
	 * Gets the custom entry sizes map.
	 */
	private readonly _customEntrySizes = new Map<number, number>();

	/**
	 * The entry map. This is keyed by position and maps position to index.
	 */
	private _entryMap: number[] | undefined;

	/**
	 * The reverse entry map. This is keyed by index and maps index to position.
	 */
	private readonly _reverseEntryMap = new Map<number, number>();

	/**
	 * Gets the pinned indexes.
	 */
	private readonly _pinnedIndexes = new Set<number>();

	/**
	 * Cached calculations below here.
	 */

	/**
	 * Gets or sets the pinned layout entries size.
	 */
	private _pinnedLayoutEntriesSize: number | undefined;

	/**
	 * Gets or sets the unpinned layout entries size.
	 */
	private _unpinnedLayoutEntriesSize: number | undefined;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param defaultSize The default size.
	 */
	constructor(defaultSize: number = 0) {
		this._defaultSize = defaultSize;
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets the first index, if any; otherwise, -1.
	 */
	get firstIndex() {
		// If there are no entries, return -1.
		if (!this._entryCount) {
			return -1;
		}

		// If there are no pinned indexes, return the index at position 0.
		if (!this._pinnedIndexes.size) {
			return this.mapPositionToIndex(0);
		}

		// Return the first pinned index, or -1 if for some reason none exists.
		const firstIteratorResult = this._pinnedIndexes.values().next();
		return firstIteratorResult.done ? -1 : firstIteratorResult.value;
	}

	/**
	 * Gets the last index, if any; otherwise, -1.
	 */
	get lastIndex() {
		// If there are no entries, return -1.
		if (!this._entryCount) {
			return -1;
		}

		// Find the last unpinned entry index.
		for (let position = this._entryCount - 1; position >= 0; position--) {
			// Map the position to an index.
			const index = this.mapPositionToIndex(position);

			// If the index is not pinned, return it.
			if (!this.isPinnedIndex(index)) {
				return index;
			}
		}

		// Find the last pinned index.
		let lastPinnedIndex: number | undefined;
		for (const pinned of this._pinnedIndexes) {
			lastPinnedIndex = pinned;
		}

		// Return the last pinned index.
		return lastPinnedIndex ?? -1;
	}

	/**
	 * Gets the pinned indexes count.
	 */
	get pinnedIndexesCount() {
		return this._pinnedIndexes.size;
	}

	/**
	 * Gets the pinned indexes.
	 */
	get pinnedIndexes() {
		return Array.from(this._pinnedIndexes);
	}

	/**
	 * Gets the pinned layout entries size.
	 */
	get pinnedLayoutEntriesSize() {
		// If the pinned layout entries size is already calculated, return it.
		if (this._pinnedLayoutEntriesSize !== undefined) {
			return this._pinnedLayoutEntriesSize;
		}

		// Calculate the pinned layout entries size.
		let size = 0;
		for (const index of this._pinnedIndexes) {
			size += this.entrySize(index);
		}

		// Cache the pinned layout entries size.
		this._pinnedLayoutEntriesSize = size;

		// Return the pinned layout entries size.
		console.log(`pinnedLayoutEntriesSize is ${size}`);
		return size;
	}

	/**
	 * Gets the unpinned layout entries size.
	 */
	get unpinnedLayoutEntriesSize() {
		// If the unpinned layout entries size is already calculated, return it.
		if (this._unpinnedLayoutEntriesSize !== undefined) {
			return this._unpinnedLayoutEntriesSize;
		}

		// Calculate the default unpinned layout entries size. This accounts for all entries.
		let size = this._entryCount * this._defaultSize;

		// Account for pinned indexes by subtracting the default size for each one.
		for (const pinnedIndex of this._pinnedIndexes) {
			if (pinnedIndex < this._entryCount) {
				size -= this._defaultSize;
			}
		}

		// Account for custom entry sizes by subtracting the default size and adding the custom entry size for each one.
		for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
			if (!this.isPinnedIndex(customEntrySizeIndex)) {
				size -= this._defaultSize;
				size += customEntrySize;
			}
		}

		// Account for entry sizes by subtracting the default size and adding the entry size for each one.
		for (const [entrySizeIndex, entrySize] of this._entrySizes) {
			if (!this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex)) {
				size -= this._defaultSize;
				size += entrySize;
			}
		}

		// Cache the unpinned layout entries size.
		this._unpinnedLayoutEntriesSize = size;

		// Return the calculated unpinned layout entries size.
		console.log(`unpinnedLayoutEntriesSize is ${size}`);
		return size;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Sets the entries.
	 * @param entryCount The entry count.
	 * @param entrySizes The entry sizes, if any. There must be exactly `entryCount` sizes.
	 * @param entryMap The entry map, if any. There must be exactly `entryCount` entries.
	 */
	setEntries(entryCount: number, entrySizes: number[] | undefined = undefined, entryMap: number[] | undefined = undefined) {
		// Invalidate cached calculations.
		this.invalidateCachedCalculations();

		// Set the entry count.
		this._entryCount = entryCount;

		// Reset advanced layout capabilities.
		this._entrySizes.clear();
		this._entryMap = undefined;
		this._reverseEntryMap.clear();

		// Enable advanced layout capabilities, if we don't have too many entries.
		if (this._entryCount <= MAX_ADVANCED_LAYOUT_ENTRY_COUNT) {
			// Set the entry sizes, if they were provided and are valid (i.e., they have the correct length).
			// This is unavoidably O(n) over entry sizes.
			if (entrySizes?.length === this._entryCount) {
				for (let i = 0; i < entrySizes.length; i++) {
					this._entrySizes.set(i, entrySizes[i]);
				}
			}

			// TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING
			// If an entry map wasn't provided, create a reverse entry map so we're always stressing the layout manager.
			if (entryMap === undefined) {
				entryMap = [];
				for (let i = this._entryCount - 1; i >= 0; i--) {
					entryMap.push(i);
				}
			}
			// TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING TESTING

			// Set the entry map and reverse entry map, if an entry map was provided and is valid (i.e., it has the correct length).
			this._entryMap = entryMap?.length === this._entryCount ? entryMap : undefined;
			if (this._entryMap) {
				for (let position = 0; position < this._entryMap.length; position++) {
					this._reverseEntryMap.set(this._entryMap[position], position);
				}
			}
		}

		// Remove any pinned indexes are no longer valid.
		for (const pinnedIndex of this._pinnedIndexes) {
			const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndex);
			if (pinnedIndexPosition && (pinnedIndexPosition < 0 || pinnedIndexPosition >= this._entryCount)) {
				this._pinnedIndexes.delete(pinnedIndex);
			}
		}
	}

	/**
	 * Maps an index to a position.
	 * @param index The index.
	 * @returns The position.
	 */
	mapIndexToPosition(index: number) {
		if (!this._entryMap) {
			return index;
		} else {
			return this._reverseEntryMap.get(index);
		}
	}

	/**
	 * Maps a position to an index.
	 * @param position The position.
	 * @returns The index.
	 */
	mapPositionToIndex(position: number) {
		if (!this._entryMap) {
			return position;
		} else {
			return this._entryMap[position];
		}
	}

	/**
	 * Sets a size override.
	 * @param index The index to set the size override for.
	 * @param sizeOverride The size override to set.
	 */
	setSizeOverride(index: number, sizeOverride: number) {
		// Validate the index and the size override.
		if (!this.validateIndex(index) || sizeOverride <= 0) {
			return;
		}

		// If the size override is the same as the current size override, return.
		if (this._customEntrySizes.get(index) === sizeOverride) {
			return;
		}

		// Set the size override.
		this._customEntrySizes.set(index, sizeOverride);

		// Invalidate cached calculations.
		this.invalidateCachedCalculations();
	}

	/**
	 * Clears a size override.
	 * @param index The index to clear the size override for.
	 */
	clearSizeOverride(index: number) {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return;
		}

		// If there isn't a custom entry size for the index, return.
		if (!this._customEntrySizes.has(index)) {
			return;
		}

		// Clear the size override.
		this._customEntrySizes.delete(index);

		// Invalidate cached calculations.
		this.invalidateCachedCalculations();
	}

	/**
	 * Checks if the given index is pinned.
	 * @param index The index to check.
	 * @returns true if the index is pinned, false otherwise.
	 */
	isPinnedIndex(index: number): boolean {
		return this._pinnedIndexes.has(index);
	}

	/**
	 * Pins an index.
	 * @param index The index to pin.
	 * @returns true if the index was pinned; otherwise, false.
	 */
	pinIndex(index: number) {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return false;
		}

		// If the index is already pinned, return.
		if (this.isPinnedIndex(index)) {
			return false;
		}

		// Pin the index.
		this._pinnedIndexes.add(index);

		// Invalidate cached calculations.
		this.invalidateCachedCalculations();

		// Return true to indicate that the index was pinned.
		return true;
	}

	/**
	 * Unpins an index
	 * @param index The index to unpin.
	 * @returns true if the index was unpinned; otherwise, false.
	 */
	unpinIndex(index: number) {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return false;
		}

		// If the index is not pinned, return.
		if (!this.isPinnedIndex(index)) {
			return false;
		}

		// Unpin the index.
		this._pinnedIndexes.delete(index);

		// Invalidate cached calculations.
		this.invalidateCachedCalculations();

		// Return true to indicate that the index was unpinned.
		return true;
	}

	/**
	 * Returns the pinned layout entries that fit within the specified layout size.
	 * @param layoutSize The layout size to fit the pinned entries within.
	 * @returns An array of the pinned layout entries, if any; otherwise, undefined.
	 */
	pinnedLayoutEntries(layoutSize: number) {
		// Validate the layout size.
		if (layoutSize <= 0) {
			return [];
		}

		// Enumerate the pinned indexes and build the pinned layout entries.
		let start = 0;
		const layoutEntries: ILayoutEntry[] = [];
		for (const index of this._pinnedIndexes) {
			// Create the layout entry.
			const size = this.entrySize(index);
			layoutEntries.push({
				index,
				start,
				size,
				end: start + size
			});

			// Increment the start by the size of the layout entry.
			start += size;

			// If the start exceeds the layout size, break.
			if (start > layoutSize) {
				break;
			}
		}

		// Return the pinned layout entries.
		return layoutEntries;
	}

	/**
	 * Returns the unpinned layout entries that overlap with the specified offset and size.
	 * @param layoutOffset The offset.
	 * @param layoutSize The size.
	 * @returns An array containing the unpinned layout entries, if any; otherwise, undefined.
	 */
	unpinnedLayoutEntries(layoutOffset: number, layoutSize: number): ILayoutEntry[] {
		// Validate the layout offset and layout size.
		if (layoutOffset < 0 || layoutSize < 0) {
			return [];
		}

		// Find the first unpinned layout entry that overlaps with the specified offset.
		const firstLayoutEntry = this.findFirstUnpinnedLayoutEntry(layoutOffset);
		if (!firstLayoutEntry) {
			return [];
		}

		// Create the layout entries array and add the first layout entry.
		const layoutEntries: ILayoutEntry[] = [firstLayoutEntry];
		const layoutEnd = layoutOffset + layoutSize;

		let start = firstLayoutEntry.end;
		for (let index = this.nextIndex(firstLayoutEntry.index); index !== undefined && start < layoutEnd; index = this.nextIndex(index)) {
			// Skip pinned indexes.
			if (this.isPinnedIndex(index)) {
				continue;
			}

			// Create the layout entry.
			const size = this.entrySize(index);
			layoutEntries.push({
				index,
				start,
				size,
				end: start + size
			});

			// Increment the start by the size of the layout entry.
			start += size;
		}

		// Return the layout entries.
		return layoutEntries;
	}

	/**
	 * Returns the previous index of the specified index.
	 * @param index The index to get the previous index for.
	 * @returns The previous index, if found; otherwise, undefined.
	 */
	previousIndex(index: number): number | undefined {
		// If the index is pinned, return the previous pinned index, if there is one.
		if (this.isPinnedIndex(index)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned index position.
			const pinnedIndexPosition = pinnedIndexesArray.indexOf(index);

			// If the pinned index position greater than zero, return the previous pinned index.
			if (pinnedIndexPosition > 0) {
				return pinnedIndexesArray[pinnedIndexPosition - 1];
			}

			// There is no previous pinned index.
			return undefined;
		}

		// When there isn't an entry map, return the previous unpinned index, if there is one; otherwise,
		// return the previous unpinned entry map index, if there is one.
		if (!this._entryMap) {
			// Return the previous unpinned index.
			for (let i = index - 1; i >= 0; i--) {
				if (!this.isPinnedIndex(i)) {
					return i;
				}
			}
		} else {
			// Get the position of the index in the entry map.
			let position = this._reverseEntryMap.get(index);
			if (position === undefined) {
				return undefined;
			}

			// Return the previous unpinned entry map index, if found.
			while (--position >= 0) {
				// Get the entry map index.
				const entryMapIndex = this._entryMap[position];

				// If the entry map index isn't pinned, return it.
				if (!this.isPinnedIndex(entryMapIndex)) {
					return entryMapIndex;
				}
			}
		}

		// This may be a transition from unpinned indexes to pinned indexes. If so, get the last
		// pinned index. If not, this will result in undefined.
		let lastPinnedIndex: number | undefined;
		for (const pinnedIndex of this._pinnedIndexes) {
			lastPinnedIndex = pinnedIndex;
		}

		// Return the last pinned index.
		return lastPinnedIndex;
	}

	/**
	 * Returns the next index after the specified index.
	 * @param startingIndex The starting index to get the next index for.
	 * @returns The next index, if found; otherwise, undefined.
	 */
	nextIndex(startingIndex: number): number | undefined {
		// Validate the index.
		if (!this.validateIndex(startingIndex)) {
			return undefined;
		}

		// If the index is pinned, return the next pinned index, if there is one; otherwise, return
		// the first unpinned index, if there is one.
		if (this.isPinnedIndex(startingIndex)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned position.
			const pinnedPosition = pinnedIndexesArray.indexOf(startingIndex);
			if (pinnedPosition === -1) {
				return undefined;
			}

			// If the pinned position is not the last pinned position, return the next pinned index.
			if (pinnedPosition < pinnedIndexesArray.length - 1) {
				return pinnedIndexesArray[pinnedPosition + 1];
			}

			// The pinned position is the last pinned position, return the first unpinned index.
			for (let position = 0; position < this._entryCount; position++) {
				// Map the position to an index.
				const index = this.mapPositionToIndex(position);

				// If the index is not pinned, return it.
				if (!this.isPinnedIndex(index)) {
					return index;
				}
			}

			// There are no unpinned indexes.
			return undefined;
		}

		// Return the next unpinned index.
		if (!this._entryMap) {
			for (let i = startingIndex + 1; i < this._entryCount; i++) {
				if (!this.isPinnedIndex(i)) {
					return i;
				}
			}
		} else {
			// Get the entry map position of the index.
			let entryMapPosition = this._reverseEntryMap.get(startingIndex);
			if (entryMapPosition === undefined) {
				return undefined;
			}

			// Return the next unpinned index, if found.
			while (++entryMapPosition < this._entryMap.length) {
				// Get the index at the position.
				const indexAtPosition = this._entryMap[entryMapPosition];

				// If the entry map index isn't pinned, return it.
				if (!this.isPinnedIndex(indexAtPosition)) {
					return indexAtPosition;
				}
			}
		}

		// There is not a next index.
		return undefined;
	}

	/**
	 * Gets a layout entry by its index.
	 * @param layoutEntryIndex The index of the layout entry to get.
	 * @returns The layout entry, if found; otherwise, undefined.
	 */
	getLayoutEntry(layoutEntryIndex: number): ILayoutEntry | undefined {
		// Validate the index.
		if (!this.validateIndex(layoutEntryIndex)) {
			return undefined;
		}

		// If the index is pinned, return the pinned layout entry.
		if (this.isPinnedIndex(layoutEntryIndex)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned index position within the pinned indexes array.
			const pinnedIndexPosition = pinnedIndexesArray.indexOf(layoutEntryIndex);
			if (pinnedIndexPosition === -1) {
				return undefined;
			}

			// Compute the start of the pinned index.
			let start = 0;
			for (let position = 0; position < pinnedIndexPosition; position++) {
				start += this.entrySize(pinnedIndexesArray[position]);
			}

			// Return the pinned layout entry.
			const size = this.entrySize(layoutEntryIndex);
			return {
				index: layoutEntryIndex,
				start,
				size,
				end: start + size,
			};
		}

		// Get the layout entry position.
		const layoutEntryPosition = this.mapIndexToPosition(layoutEntryIndex);
		if (layoutEntryPosition === undefined) {
			return undefined;
		}

		// Calculate the start as if there were no pinned indexes, no custom entry sizes, and no entry sizes.
		let start = layoutEntryPosition * this._defaultSize;

		// Adjust the start to account for pinned indexes. This is unavoidably O(n) over pinned indexes.
		for (const pinnedIndex of this._pinnedIndexes) {
			// Get the pinned index position.
			const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndex);
			if (pinnedIndexPosition === undefined) {
				continue;
			}

			// If the pinned index position is before the layout entry position, subtract the default size.
			if (pinnedIndexPosition < layoutEntryPosition) {
				start -= this._defaultSize;
			}
		}

		// Adjust the start to account for custom entry sizes. This is unavoidably O(n) over custom entry sizes.
		for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
			// If the custom entry size index is pinned, skip it.
			if (this.isPinnedIndex(customEntrySizeIndex)) {
				continue;
			}

			// Get the custom entry size position.
			const customEntrySizePosition = this.mapIndexToPosition(customEntrySizeIndex);
			if (customEntrySizePosition === undefined) {
				continue;
			}

			// If the custom entry size position is before the layout entry position, adjust the start for it.
			if (customEntrySizePosition < layoutEntryPosition) {
				start -= this._defaultSize;
				start += customEntrySize;
			}
		}

		// Adjust the start to account for entry sizes. This is unavoidably O(n) over entry sizes.
		for (const [entrySizeIndex, entrySize] of this._entrySizes) {
			// If the entry size index is pinned, skip it.
			if (this.isPinnedIndex(entrySizeIndex)) {
				continue;
			}

			// Get the entry size position.
			const entrySizePosition = this.mapIndexToPosition(entrySizeIndex);
			if (entrySizePosition === undefined) {
				continue;
			}

			// If the entry size position is before the layout entry position, adjust the start for it.
			if (entrySizePosition < layoutEntryPosition) {
				start -= this._defaultSize;
				start += entrySize;
			}
		}

		// Return the layout entry.
		const size = this.entrySize(layoutEntryIndex);
		return {
			index: layoutEntryIndex,
			start,
			size,
			end: start + size,
		};
	}

	/**
	 * Finds the first unpinned layout entry that contains the given layout offset.
	 * @param layoutOffset The layout offset to find the first unpinned layout entry for.
	 * @returns The first unpinned layout entry that contains the layout offset, or undefined if none is found.
	 */
	findFirstUnpinnedLayoutEntry(layoutOffset: number): ILayoutEntry | undefined {
		// Return undefined if there are no entries or the layout offset is invalid.
		if (!this._entryCount || layoutOffset < 0) {
			return undefined;
		}

		// Shortcut for full-span layout: when the layout offset is 0, the default size is 0,
		// and the entry count is 1, this represents a dynamically sized full-width column or
		// full-height row. Return the only possible layout entry.
		if (layoutOffset === 0 && this._defaultSize === 0 && this._entryCount === 1) {
			return {
				index: 0,
				start: 0,
				size: 0,
				end: 0,
			};
		}

		// Outside the binary search, get the pinned indexes, filtered custom entry sizes, and filtered entry sizes.
		const pinnedIndexes = Array.from(this._pinnedIndexes);
		const customEntrySizes = [...this._customEntrySizes.entries()].filter(([customEntrySizeIndex]) => !this.isPinnedIndex(customEntrySizeIndex));
		const entrySizes = [...this._entrySizes.entries()].filter(([entrySizeIndex]) => !this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex));

		// Binary search to find the first unpinned layout entry that contains the offset.
		let leftPosition = 0;
		let rightPosition = this._entryCount - 1;
		while (leftPosition <= rightPosition) {
			// Calculate the middle position.
			const middlePosition = Math.floor((leftPosition + rightPosition) / 2);

			// Get the middle position.
			const middleIndex = this.mapPositionToIndex(middlePosition);

			// Compute the start of the middle position as if there were no pinned indexes, no custom entry sizes, and no entry sizes.
			let start = middlePosition * this._defaultSize;

			// Adjust the start to account for pinned indexes. This is unavoidably O(n) over pinned indexes.
			for (let i = 0; i < pinnedIndexes.length; i++) {
				const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndexes[i]);
				if (pinnedIndexPosition !== undefined && pinnedIndexPosition < middlePosition) {
					start -= this._defaultSize;
				}
			}

			// Adjust the start to account for custom entry sizes. This is unavoidably O(n) over custom entry sizes.
			for (const [customEntrySizeIndex, customEntrySize] of customEntrySizes) {
				// Get the custom entry size position.
				const customEntrySizePosition = this.mapIndexToPosition(customEntrySizeIndex);
				if (customEntrySizePosition === undefined) {
					continue;
				}

				// If the custom entry size position is before the layout entry position, adjust the start for it.
				if (customEntrySizePosition < middlePosition) {
					start -= this._defaultSize;
					start += customEntrySize;
				}
			}

			// Adjust the start to account for entry sizes. This is unavoidably O(n) over entry sizes.
			for (const [entrySizeIndex, entrySize] of entrySizes) {
				// Get the entry size position.
				const entrySizePosition = this.mapIndexToPosition(entrySizeIndex);
				if (entrySizePosition === undefined) {
					continue;
				}

				// If the entry size position is before the layout entry position, adjust the start for it.
				if (entrySizePosition < middlePosition) {
					start -= this._defaultSize;
					start += entrySize;
				}
			}

			// If the layout offset is less than the start, search the left half.
			if (layoutOffset < start) {
				rightPosition = middlePosition - 1;
				continue;
			}

			// Now that we know the start, we can check if the layout offset is within the middle entry.
			if (layoutOffset >= start && layoutOffset < start + this.entrySize(middleIndex)) {
				// Set the first unpinned index.
				let firstUnpinnedIndex = middleIndex;

				// If the first unpinned index is pinned, scan backwards and forwards to find the first unpinned index.
				if (this.isPinnedIndex(firstUnpinnedIndex)) {
					// Scan backward from the middle position for the first unpinned index.
					let backwardScanPosition = middlePosition;
					while (--backwardScanPosition >= 0) {
						const index = this.mapPositionToIndex(backwardScanPosition);
						if (!this.isPinnedIndex(index)) {
							firstUnpinnedIndex = index;
							break;
						}
					}

					// If backward scan fails, scan forward from the middle position.
					if (backwardScanPosition === -1) {
						let forwardScanPosition = middlePosition;
						while (++forwardScanPosition < this._entryCount) {
							const index = this.mapPositionToIndex(forwardScanPosition);
							if (!this.isPinnedIndex(index)) {
								firstUnpinnedIndex = index;
								break;
							}
						}

						// If the first unpinned index was not found in either direction, return undefined.
						if (forwardScanPosition === this._entryCount) {
							return undefined;
						}
					}
				}

				// Return the layout entry for the first unpinned index.
				const size = this.entrySize(firstUnpinnedIndex);
				return {
					index: firstUnpinnedIndex,
					start,
					size,
					end: start + size,
				};
			}

			// Setup the next binary search.
			leftPosition = middlePosition + 1;
		}

		// The first layout entry was not found.
		return undefined;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Validates an index.
	 * @param index The index to validate.
	 * @returns true if the index is valid, false otherwise.
	 */
	private validateIndex(index: number) {
		// If the number is not an integer or is negative, return false.
		if (!Number.isInteger(index) || index < 0) {
			return false;
		}

		// Validate the index.
		return this._entryMap ? this._reverseEntryMap.has(index) : index < this._entryCount;
	}

	/**
	 * Invalidates the cached layout entry sizes.
	 */
	private invalidateCachedCalculations() {
		this._pinnedLayoutEntriesSize = undefined;
		this._unpinnedLayoutEntriesSize = undefined;
	}

	/**
	 * Gets the size of the entry at the specified index.
	 * @param index The index of the entry.
	 * @returns The size of the entry.
	 */
	private entrySize(index: number): number {
		// If a custom size is set for the index, return it.
		const customSize = this._customEntrySizes.get(index);
		if (customSize !== undefined) {
			return customSize;
		}

		// If an entry size is set for the index, return it.
		const entrySize = this._entrySizes.get(index);
		if (entrySize !== undefined) {
			return entrySize;
		}

		// Return the default size.
		return this._defaultSize;
	}

	//#endregion Private Methods
}
