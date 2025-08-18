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
	private _entrySizes = new Map<number, number>();

	/**
	 * Gets the custom entry sizes map.
	 */
	private readonly _customEntrySizes = new Map<number, number>();

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
	private _pinnedLayoutEntriesSize: number | undefined = undefined;

	/**
	 * Gets or sets the unpinned layout entries size.
	 */
	private _unpinnedLayoutEntriesSize: number | undefined = undefined;

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

		// If there are no pinned indexes, return the first index.
		if (!this._pinnedIndexes.size) {
			return 0;
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

		// Find the last unpinned index.
		for (let i = this._entryCount - 1; i >= 0; i--) {
			if (!this.isPinnedIndex(i)) {
				return i;
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

		// Calculate the default unpinned layout entries size.
		let size = this._entryCount * this._defaultSize;

		// Account for pinned indexes by subtracting the default size for each one.
		for (const pinnedIndex of this._pinnedIndexes) {
			if (pinnedIndex < this._entryCount) {
				size -= this._defaultSize;
			}
		}

		// Account for custom entry sizes by subtracting the default size and adding the custom entry size for each one.
		for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
			if (customEntrySizeIndex < this._entryCount && !this.isPinnedIndex(customEntrySizeIndex)) {
				size -= this._defaultSize;
				size += customEntrySize;
			}
		}

		// Account for entry sizes by subtracting the default size and adding the entry size for each one.
		for (const [entrySizeIndex, entrySize] of this._entrySizes) {
			if (entrySizeIndex < this._entryCount && !this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex)) {
				size -= this._defaultSize;
				size += entrySize;
			}
		}

		// Cache the unpinned layout entries size.
		this._unpinnedLayoutEntriesSize = size;

		// Return the calculated unpinned layout entries size.
		return size;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Sets the entries.
	 * @param entryCount The entry count.
	 * @param entrySizes The entry sizes, if any.
	 */
	setEntries(entryCount: number, entrySizes: number[] | undefined = undefined) {
		// Invalidate cached calculations.
		this.invalidateCachedCalculations();

		// Validate the entry sizes. If they are bogus, set them to undefined to fail silently.
		if (entrySizes && entrySizes.length !== entryCount) {
			entrySizes = undefined;
		}

		// Set the entries.
		this._entryCount = entryCount;
		this._entrySizes.clear();
		if (entrySizes) {
			for (let i = 0; i < entrySizes.length; i++) {
				this._entrySizes.set(i, entrySizes[i]);
			}
		}

		// Remove pinned indexes that are beyond the entry count.
		for (const pinnedIndex of this._pinnedIndexes) {
			// If the pinned index is beyond the entry count, delete it.
			if (pinnedIndex >= this._entryCount) {
				this._pinnedIndexes.delete(pinnedIndex);
			}
		}
	}

	/**
	 * Sets a size override.
	 * @param index The index to set the size override for.
	 * @param sizeOverride The size override to set.
	 */
	setSizeOverride(index: number, sizeOverride: number) {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return;
		}

		// Validate the size override.
		if (sizeOverride <= 0) {
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
		const pinnedLayoutEntries: ILayoutEntry[] = [];
		for (const index of this._pinnedIndexes) {
			// Get the size.
			const size = this.entrySize(index);

			// Create the layout entry.
			pinnedLayoutEntries.push({
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
		return pinnedLayoutEntries;
	}

	/**
	 * Returns the unpinned layout entries that overlap with the specified offset and size.
	 * @param layoutOffset The offset.
	 * @param layoutSize The size.
	 * @returns An array containing the unpinned layout entries, if any; otherwise, undefined.
	 */
	unpinnedLayoutEntries(layoutOffset: number, layoutSize: number): ILayoutEntry[] {
		// Validate the offset and size.
		if (layoutOffset < 0 || layoutSize <= 0) {
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

		// Find the rest of the unpinned layout entries to return.
		let start = firstLayoutEntry.end;
		for (let index = firstLayoutEntry.index + 1; index < this._entryCount && start < layoutEnd; index++) {
			// Skip pinned indexes.
			if (this.isPinnedIndex(index)) {
				continue;
			}

			// Get the size.
			const size = this.entrySize(index);

			// Create the layout entry.
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
	 * Returns the previous index for the specified index.
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

			// This can't happen. We know for certain that the index is pinned.
			if (pinnedIndexPosition === -1) {
				return undefined;
			}

			// If the pinned index position is not the first pinned index position, return the previous pinned index.
			if (pinnedIndexPosition > 0) {
				return pinnedIndexesArray[pinnedIndexPosition - 1];
			}

			// The pinned index position is zero, so there is no previous pinned index.
			return undefined;
		}

		// Return the previous index.
		for (let i = index - 1; i >= 0; i--) {
			if (!this.isPinnedIndex(i)) {
				return i;
			}
		}

		// Get the pinned indexes as an array. If there are pinned indexes, return the last one.
		const pinnedIndexesArray = Array.from(this._pinnedIndexes);
		if (pinnedIndexesArray.length) {
			return pinnedIndexesArray[pinnedIndexesArray.length - 1];
		}

		// There is not a previous index.
		return undefined;
	}

	/**
	 * Returns the next index after the specified index.
	 * @param index The index to get the next index for.
	 * @returns The next index, if found; otherwise, undefined.
	 */
	nextIndex(index: number): number | undefined {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return undefined;
		}

		// If the index is pinned, return the next pinned index, if there is one.
		if (this.isPinnedIndex(index)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned position.
			const pinnedPosition = pinnedIndexesArray.indexOf(index);

			// This can't happen. We know for certain that the index is pinned.
			if (pinnedPosition === -1) {
				return undefined;
			}

			// If the pinned position is not the last pinned position, return the next pinned index.
			if (pinnedPosition < pinnedIndexesArray.length - 1) {
				return pinnedIndexesArray[pinnedPosition + 1];
			}

			// Return the first unpinned index.
			for (let i = 0; i < this._entryCount; i++) {
				if (!this.isPinnedIndex(i)) {
					return i;
				}
			}

			// There are no unpinned indexes.
			return undefined;
		}

		// Return the next unpinned index.
		for (let i = index + 1; i < this._entryCount; i++) {
			if (!this.isPinnedIndex(i)) {
				return i;
			}
		}

		// There is not a next index.
		return undefined;
	}

	/**
	 * Gets a layout entry by its index.
	 * @param index The index of the layout entry.
	 * @returns The layout entry at the specified index, if found; otherwise, undefined.
	 */
	getLayoutEntry(index: number): ILayoutEntry | undefined {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return undefined;
		}

		// If the index is pinned, return the pinned layout entry.
		if (this.isPinnedIndex(index)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned index position within the pinned indexes array.
			const pinnedIndexPosition = pinnedIndexesArray.indexOf(index);

			// This can't happen. We know for certain that the index is pinned.
			if (pinnedIndexPosition === -1) {
				return undefined;
			}

			// Compute the start of the pinned index.
			let start = 0;
			for (let i = 0; i < pinnedIndexPosition; i++) {
				start += this.entrySize(pinnedIndexesArray[i]);
			}

			// Get the size.
			const size = this.entrySize(index);

			// Return the pinned layout entry.
			return {
				index,
				start,
				size,
				end: start + size,
			};
		}

		// Get the pinned indexes count.
		const pinnedIndexesCount = [...this._pinnedIndexes].reduce(
			(count, pinnedIndex) => count + (pinnedIndex < index ? 1 : 0),
			0
		);

		// Compute the start.
		let start = (index - pinnedIndexesCount) * this._defaultSize;

		// Adjust the start to account for custom entry sizes.
		for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
			if (customEntrySizeIndex < index && !this.isPinnedIndex(customEntrySizeIndex)) {
				start -= this._defaultSize;
				start += customEntrySize;
			}
		}

		// Adjust the start to account for entry sizes.
		for (const [entrySizeIndex, entrySize] of this._entrySizes) {
			if (entrySizeIndex < index && !this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex)) {
				start -= this._defaultSize;
				start += entrySize;
			}
		}

		// Get the size.
		const size = this.entrySize(index);

		// Return the layout entry.
		return {
			index,
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

		// Get the sorted pinned indexes, sorted custom entry size indexes, and sorted entry size
		// indexes. These will be used to calculate the start of the middle index as efficiently as
		// possible.
		const pinnedIndexes = [...this._pinnedIndexes].sort((a, b) => a - b);
		const sortedCustomEntrySizes = [...this._customEntrySizes.entries()]
			.filter(([customEntrySizeIndex]) => !this.isPinnedIndex(customEntrySizeIndex))
			.sort(([a], [b]) => a - b);
		const sortedEntrySizes = [...this._entrySizes.entries()]
			.filter(([entrySizeIndex]) => !this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex))
			.sort(([a], [b]) => a - b);

		// Binary search to find the first unpinned layout entry that contains the offset.
		let leftIndex = 0;
		let rightIndex = this._entryCount - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle index.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);

			// Compute the start.
			let start = middleIndex * this._defaultSize;

			// Adjust the start to account for pinned indexes.
			for (let i = 0; i < pinnedIndexes.length; i++) {
				const pinnedIndex = pinnedIndexes[i];
				if (pinnedIndex < middleIndex) {
					start -= this._defaultSize;
				} else {
					// No need to check further for pinned indexes.
					break;
				}
			}

			// Adjust the start to account for custom entry sizes.
			for (const [customEntrySizeIndex, customEntrySize] of sortedCustomEntrySizes) {
				if (customEntrySizeIndex < middleIndex) {
					start -= this._defaultSize;
					start += customEntrySize;
				} else {
					break;
				}
			}

			// Adjust the start to account for entry sizes.
			for (const [entrySizeIndex, entrySize] of sortedEntrySizes) {
				if (entrySizeIndex < middleIndex) {
					start -= this._defaultSize;
					start += entrySize;
				} else {
					break;
				}
			}

			// If the layout offset is less than the start, search the left half.
			if (layoutOffset < start) {
				rightIndex = middleIndex - 1;
				continue;
			}

			// Now that we know the start, we can check if the layout offset is within the middle entry.
			if (layoutOffset >= start && layoutOffset < start + this.entrySize(middleIndex)) {
				// Set the first unpinned index.
				let firstUnpinnedIndex = middleIndex;

				// If the first unpinned index is pinned, scan backwards and forwards to find the first unpinned index.
				if (this.isPinnedIndex(firstUnpinnedIndex)) {
					// Scan backwards for the first unpinned index.
					while (firstUnpinnedIndex >= 0 && this.isPinnedIndex(firstUnpinnedIndex)) {
						firstUnpinnedIndex--;
					}

					// If scanning backwards for the first unpinned index didn't succeed, scan forwards for the first unpinned index.
					if (firstUnpinnedIndex < 0) {
						// Scan forwards for the first unpinned index.
						firstUnpinnedIndex = middleIndex + 1;
						while (firstUnpinnedIndex < this._entryCount && this.isPinnedIndex(firstUnpinnedIndex)) {
							firstUnpinnedIndex++;
						}

						// If the first unpinned index was not found in either direction, return undefined.
						if (firstUnpinnedIndex === this._entryCount) {
							return undefined;
						}
					}
				}

				// Get the size of the first unpinned index.
				const size = this.entrySize(firstUnpinnedIndex);

				// Return the layout entry for the first unpinned index.
				return {
					index: firstUnpinnedIndex,
					start,
					size,
					end: start + size,
				};
			}

			// Setup the next binary search.
			leftIndex = middleIndex + 1;
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
		return Number.isInteger(index) && index >= 0 && index < this._entryCount;
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
