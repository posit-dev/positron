/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LayoutManager is used to manage the layout of columns and rows in a data grid.
 *
 * In this code:
 * index       - Represents the index of a column or row.
 * start       - Represents the X or Y coordinate of a column or row.
 * size        - Represents the width or height of a column or row.
 * end         - Represents the X or Y coordinate of the end of a column or row.
 * defaultSize - Represents the default width or height of a column or row.
 * customSize  - Represents the custom width or height of a column or row (if set).
 */

/**
 * ILayoutEntry interface.
 */
export interface ILayoutEntry {
	/**
	 * Gets index.
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
	 * Gets the pinned indexes.
	 */
	private readonly _pinnedIndexes = new Set<number>();

	/**
	 * Gets the custom entry sizes map.
	 */
	private readonly _customEntrySizes = new Map<number, number>();

	/**
	 * Gets or sets the unpinned layout entries.
	 */
	private _unpinnedLayoutEntries: ILayoutEntry[] = [];

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
	 * Gets the pinned layout entries size.
	 */
	get pinnedLayoutEntriesSize() {
		// Calculate the size of the pinned layout entries.
		let size = 0;
		for (const index of this._pinnedIndexes) {
			size += this.entrySize(index);
		}

		// Return the size of the pinned layout entries.
		return size;
	}

	/**
	 * Gets the unpinned layout entries size.
	 */
	get unpinnedLayoutEntriesSize() {
		// If there are entry sizes, calculate the size of the unpinned layout entries based on the
		// entry sizes and custom sizes.
		if (this._entrySizes.size) {
			let unpinnedLayoutEntriesSize = 0;
			this._entrySizes.forEach((entrySize, index) => {
				if (!this._pinnedIndexes.has(index)) {
					unpinnedLayoutEntriesSize += this._customEntrySizes.get(index) ?? entrySize;
				}
			});

			// Return the calculated unpinned layout entries size.
			return unpinnedLayoutEntriesSize;
		}

		// Calculate the default size of the unpinned layout entries.
		let unpinnedLayoutEntriesSize = (this._entryCount - this._pinnedIndexes.size) * this._defaultSize;

		// Factor in the custom sizes.
		for (const [index, customSize] of this._customEntrySizes) {
			if (!this._pinnedIndexes.has(index)) {
				unpinnedLayoutEntriesSize -= this._defaultSize;
				unpinnedLayoutEntriesSize += customSize;
			}
		}

		// Return the calculated unpinned layout entries size.
		return unpinnedLayoutEntriesSize;
	}

	/**
	 * Gets the number of pinned indexes.
	 */
	get pinnedIndexesCount() {
		return this._pinnedIndexes.size;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Sets the entries.
	 * @param entryCount The entry count.
	 * @param entrySizes The entry sizes, if any.
	 */
	setEntries(entryCount: number, entrySizes: number[] | undefined = undefined) {
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

		// Update layout.
		this.updateLayout();
	}

	/**
	 * Gets a layout entry by index
	 * @param index The index of the layout entry.
	 * @returns The layout entry at the specified index, if found; otherwise, undefined.
	 */
	getLayoutEntry(index: number): ILayoutEntry | undefined {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return undefined;
		}

		// If the index is pinned, return the pinned layout entry.
		if (this._pinnedIndexes.has(index)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned index position within the pinned indexes array.
			const pinnedIndexPosition = pinnedIndexesArray.indexOf(index);

			// This can't happen. (We know for certain that the index is pinned.)
			if (pinnedIndexPosition === -1) {
				return undefined;
			}

			// Compute the start of the pinned index as if there were no entry sizes or custom entry sizes.
			// A lot of the time, this will be the correct start of the pinned index.
			let start = pinnedIndexPosition * this._defaultSize;

			// Account for custom entry sizes before the pinned index by subtracting the default
			// size and adding the custom entry size for each one. Since there are always a small
			// number of custom entry sizes, this fast operation.
			for (const [index1, customSize] of this._customEntrySizes) {
				if (index1 < index) {
					start -= this._defaultSize;
					start += customSize;
				}
			}

			// Account for entry sizes before the pinned index by subtracting the default size and
			// adding the entry size for each one.
			for (const [index1, entrySize] of this._entrySizes) {
				// If the index is before the pinned index and is not pinned or a custom entry size,
				// adjust the start.
				if (index1 < index && !this._customEntrySizes.has(index1)) {
					start -= this._defaultSize;
					start += entrySize;
				}
			}

			// Return the pinned layout entry.
			const size = this.entrySize(index);
			return {
				index,
				start,
				size,
				end: start + size,
			};
		}

		// Compute the start.
		let start = index * this._defaultSize;

		// Account for pinned indexes before the middle index by subtracting the default size
		// for each one. Since there are always a small number of pinned indexes, this is a
		// fast operation.
		for (const index1 of this._pinnedIndexes) {
			if (index1 < index) {
				start -= this._defaultSize;
			}
		}

		// Account for custom entry sizes before the middle index by subtracting the default
		// size and adding the custom entry size for each one. Since there are always a small
		// number of custom entry sizes, this fast operation.
		for (const [index1, customEntrySize] of this._customEntrySizes) {
			// If the index is before the middle index and is not pinned, adjust the start.
			if (index1 < index && !this._pinnedIndexes.has(index)) {
				start -= this._defaultSize;
				start += customEntrySize;
			}
		}

		// Account for entry sizes before the middle index by subtracting the default size and
		// adding the entry size for each one.
		for (const [index1, size] of this._entrySizes) {
			// If the index is before the middle index and is not pinned or a custom entry size,
			// adjust the start.
			if (index1 < index && !this._pinnedIndexes.has(index) && !this._customEntrySizes.has(index)) {
				start -= this._defaultSize;
				start += size;
			}
		}

		// Return the layout entry.
		const size = this.entrySize(index);
		return {
			index,
			start,
			size,
			end: start + size,
		};
	}

	/**
	 * Returns a value which indicates whether the specified index is pinned.
	 * @param index The index to check.
	 */
	isIndexPinned(index: number) {
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
		if (this._pinnedIndexes.has(index)) {
			return false;
		}

		// Pin the index.
		this._pinnedIndexes.add(index);

		// Update layout.
		this.updateLayout();

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
		if (!this._pinnedIndexes.has(index)) {
			return false;
		}

		// Unpin the index.
		this._pinnedIndexes.delete(index);

		// Update layout.
		this.updateLayout();

		// Return true to indicate that the index was unpinned.
		return true;
	}

	/**
	 * Sets a size override.
	 * @param index The index to set the size override for.
	 */
	setSizeOverride(index: number, overrideSize: number) {
		// Validate the index.
		if (!this.validateIndex(index)) {
			return;
		}

		// Validate the override size.
		if (overrideSize <= 0) {
			return;
		}

		// Set the size override.
		this._customEntrySizes.set(index, overrideSize);

		// Update layout.
		this.updateLayout();
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

		// Clear the size override.
		this._customEntrySizes.delete(index);

		// Update layout.
		this.updateLayout();
	}

	/**
	 * Returns the pinned layout entries that fit within the specified layout size.
	 * @returns An array of the pinned layout entries, if any; otherwise, undefined.
	 */
	pinnedLayoutEntries(layoutSize: number) {
		const startTime = performance.now();

		// Enumerate the pinned indexes and build the pinned layout entries.
		let start = 0;
		const pinnedLayoutEntries: ILayoutEntry[] = [];
		for (const index of this._pinnedIndexes) {
			// Create the layout entry.
			const size = this.entrySize(index);
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

		const endTime = performance.now();
		console.log(`Built pinned layout entries in ${endTime - startTime}ms.`);

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

		const startTime = performance.now();

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
			if (this._pinnedIndexes.has(index)) {
				continue;
			}

			const size = this.entrySize(index);
			layoutEntries.push({
				index,
				start,
				size,
				end: start + size
			});

			start += size;
		}

		const endTime = performance.now();
		console.log(`Built unpinned layout entries in ${endTime - startTime}ms.`);

		return layoutEntries;
	}

	/**
	 * Gets the first index.
	 */
	get firstIndex() {
		// If there are no entries, return -1.
		if (!this._entryCount) {
			return -1;
		}

		// If there are pinned indexes, return the first pinned index.
		if (this._pinnedIndexes.size) {
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);
			return pinnedIndexesArray[0];
		}

		// Return the first index.
		return 0;
	}

	/**
	 * Gets the last index.
	 */
	get lastIndex() {
		// Get the entry count.
		const entryCount = this._entryCount;

		// If there are no entries, return -1.
		if (!entryCount) {
			return -1;
		}

		// If every entry is pinned, return the last pinned index.
		if (this._pinnedIndexes.size === entryCount) {
			let lastPinnedIndex = 0;
			for (const pinnedIndex of this._pinnedIndexes) {
				lastPinnedIndex = pinnedIndex;
			}
			return lastPinnedIndex;
		}

		// Find the last unpinned index.
		for (let i = this._entryCount - 1; i >= 0; i--) {
			if (!this._pinnedIndexes.has(i)) {
				return i;
			}
		}

		// Getting here indicates a bug. We should have found an unpinned index.
		return -1;
	}

	/**
	 * Returns the previous index for the specified index.
	 * @param index The index to get the previous index for.
	 * @returns The previous index, if found; otherwise, undefined.
	 */
	previousIndex(index: number): number | undefined {
		// If the index is pinned, return the previous pinned index, if there is one.
		if (this._pinnedIndexes.has(index)) {
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

		// Loop over all entries. Build an array of unpinned indexes.
		// 1 2 3 4 5 6


		// Get the unpinned index position.
		const unpinnedIndexPosition = this.unpinnedIndexPosition(index);

		// If the unpinned index position is undefined, it indicate that there is a bug. Just return undefined.
		if (unpinnedIndexPosition === undefined) {
			return undefined;
		}

		// If the unpinned index position is greater than zero, return the previous unpinned index.
		if (unpinnedIndexPosition > 0) {
			return this._unpinnedLayoutEntries[unpinnedIndexPosition - 1].index;
		}

		if (this._pinnedIndexes.size) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			return pinnedIndexesArray[pinnedIndexesArray.length - 1];
		}

		return undefined;
	}

	/**
	 *
	 * @param index
	 * @returns
	 */
	nextIndex(index: number): number | undefined {
		// If the index is pinned, return the next pinned index, if there is one; otherwise, return
		// the first unpinned index.
		if (this._pinnedIndexes.has(index)) {
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

			// The pinned position is the last pinned position, so there is no next pinned index. In
			// this case, return the first unpinned index.
			for (let i = 0; i < this._entryCount; i++) {
				if (!this._pinnedIndexes.has(i)) {
					return i;
				}
			}
		}

		// The index is not pinned.
		for (let i = 0; i < this._entryCount; i++) {
		}

		// Get the unpinned index position.
		const unpinnedIndexPosition = this.unpinnedIndexPosition(index);

		// If the unpinned index position is undefined, it indicate that there is a bug. Just return undefined.
		if (unpinnedIndexPosition === undefined) {
			return undefined;
		}

		// If the unpinned index position is less than the unpinned layout entries, return the next unpinned index.
		if (unpinnedIndexPosition < this._unpinnedLayoutEntries.length - 1) {
			return this._unpinnedLayoutEntries[unpinnedIndexPosition + 1].index;
		}

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
	 * Finds the first unpinned layout entry that contains the given layout offset.
	 * @param layoutOffset The layout offset to find the first unpinned layout entry for.
	 * @returns The first unpinned layout entry that contains the layout offset, or undefined if none is found.
	 */
	findFirstUnpinnedLayoutEntry(layoutOffset: number): ILayoutEntry | undefined {
		let start = performance.now();
		try {
			// Binary search the layout entries to find the layout entry that contains the offset.
			let left = 0;
			let right = this._entryCount - 1;
			while (left <= right) {
				// Calculate the middle.
				const middle = Math.floor((left + right) / 2);

				// Compute the start of the middle.
				const start = this.computeStart(middle);

				// If the layout offset is less than the start, search the left half.
				if (layoutOffset < start) {
					right = middle - 1;
					continue;
				}

				// Now we know the start position of the middle index, we can check if the layout offset is within this entry.
				if (layoutOffset >= start && layoutOffset <= start + this.entrySize(middle)) {
					// Set the index.
					let index = middle;

					// If the index is pinned, scan backwards and forwards to find the first unpinned index to return.
					if (this._pinnedIndexes.has(middle)) {
						// Scan backwards for an unpinned index.
						while (index >= 0 && this._pinnedIndexes.has(index)) {
							index--;
						}

						// If scanning backwards didn't find an unpinned index, scan forwards for an unpinned index.
						if (index < 0) {
							// Scan forwards for an unpinned index.
							index = middle + 1;
							while (index < this._entryCount && this._pinnedIndexes.has(index)) {
								index++;
							}

							// If no unpinned index was found in either direction, the first layout entry was not found.
							if (index === this._entryCount) {
								return undefined;
							}
						}
					}

					// Return the layout entry.
					const size = this.entrySize(index);
					return {
						index,
						start,
						size,
						end: start + size,
					};
				}

				// Setup the next binary search.
				left = middle + 1;
			}

			// The first layout entry was not found.
			return undefined;
		} finally {
			let end = performance.now();

			console.log(`LayoutManager.findFirstUnpinnedLayoutEntry took ${end - start}ms for offset ${layoutOffset}.`);
		}
	}

	private computeStart(index: number) {
		// Compute the start of the middle index.
		let start = index * this._defaultSize;

		// Account for pinned indexes before the middle index by subtracting default size for each
		// one. Since there are always a small number of pinned indexes, this is a fast operation.
		for (const pinnexIndex of this._pinnedIndexes) {
			if (pinnexIndex < index) {
				start -= this._defaultSize;
			}
		}

		// Account for custom entry sizes before the middle index by subtracting the default
		// size and adding the custom entry size for each one. Since there are always a small
		// number of custom entry sizes, this fast operation.
		for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
			// If the index is before the middle index and is not pinned, adjust the start.
			if (customEntrySizeIndex < index && !this._pinnedIndexes.has(customEntrySizeIndex)) {
				start -= this._defaultSize;
				start += customEntrySize;
			}
		}

		// Account for entry sizes before the middle index by subtracting the default size and
		// adding the entry size for each one.
		for (const [entrySizeIndex, entrySize] of this._entrySizes) {
			// If the index is before the middle index and is not pinned and does not have a custom
			// entry size, adjust the start.
			if (entrySizeIndex < index && !this._pinnedIndexes.has(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex)) {
				start -= this._defaultSize;
				start += entrySize;
			}
		}

		// Return the start of the middle index.
		return start;
	}



	private unpinnedIndexPosition(index: number): number | undefined {
		let leftIndex = 0;
		let rightIndex = this._unpinnedLayoutEntries.length - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle index and get the middle layout entry to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

			// Check if the middle layout entry is for the specified index.
			if (middleLayoutEntry.index === index) {
				return middleIndex;
			}

			// Setup the next binary search.
			if (middleLayoutEntry.index < index) {
				leftIndex = middleIndex + 1;
			} else {
				rightIndex = middleIndex - 1;
			}
		}

		// Not found.
		return undefined;
	}

	/**
	 * Updates layout.
	 */
	private updateLayout() {

		// Remove pinned indexes that are beyond the entry count.
		for (const index of this._pinnedIndexes) {
			// If the pinned index is beyond the entry count, delete it.
			if (index >= this._entryCount) {
				this._pinnedIndexes.delete(index);
			}
		}

		// // Create the unpinned layout entries.
		// this._unpinnedLayoutEntries = new Array<ILayoutEntry>(this._entryCount - this._pinnedIndexes.size);
		// let start = 0;
		// let outputIndex = 0;
		// for (let index = 0; index < this._entryCount; index++) {
		// 	// Skip pinned indexes.
		// 	if (this._pinnedIndexes.has(index)) {
		// 		continue;
		// 	}

		// 	// Create the unpinned layout entry.
		// 	const size = this.entrySize(index);
		// 	this._unpinnedLayoutEntries[outputIndex++] = {
		// 		index,
		// 		start,
		// 		size,
		// 		end: start + size
		// 	};

		// 	// Adjust the start for the next unpinned layout entry.
		// 	start += size;
		// }

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
