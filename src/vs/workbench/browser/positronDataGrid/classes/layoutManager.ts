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
 * LayoutEntry class.
 */
class LayoutEntry implements ILayoutEntry {
	//#region Public Properties

	/**
	 * Gets the index.
	 */
	readonly index: number;

	/**
	 * Gets the start.
	 */
	start: number;

	/**
	 * Gets the default size.
	 */
	defaultSize: number;

	/**
	 * Gets the custom size.
	 */
	customSize?: number;

	/**
	 * Gets the size.
	 */
	get size() {
		return this.customSize ?? this.defaultSize;
	}

	/**
	 * Gets the end.
	 */
	get end() {
		return this.start + this.size;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param index The index.
	 * @param start The start.
	 * @param defaultSize The default size.
	 * @param customSize The custom size.
	 */
	constructor(index: number, start: number, defaultSize: number, customSize?: number) {
		this.index = index;
		this.start = start;
		this.defaultSize = defaultSize;
		this.customSize = customSize;
	}

	//#endregion Constructor
}

/**
 * ICustomSize interface.
 */
interface ICustomSize {
	/**
	 * Gets index.
	 */
	readonly index: number;

	/**
	 * Gets the custom size.
	 */
	readonly customSize: number;
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
	 * Gets or sets the entries. This is either the number of entries or an array of entry sizes.
	 */
	private _entries: number | number[] = 0;

	/**
	 * Gets the entry count.
	 */
	private get entryCount() {
		return typeof this._entries === 'number' ? this._entries : this._entries.length;
	}

	/**
	 * Gets the pinned indexes set. This is keyed by index.
	 */
	private readonly _pinnedIndexes = new Set<number>();

	/**
	 * Gets the custom sizes map. This is keyed by index and contains the custom size for that index.
	 */
	private readonly _customSizes = new Map<number, number>();

	/**
	 * Gets the sorted custom sizes.
	 */
	private get sortedCustomSizes() {
		return Array.from(this._customSizes).
			map(([index, size]): ICustomSize => ({ index, customSize: size })).
			sort((a, b) => a.index - b.index);
	}

	/**
	 * Gets or sets the pinned layout entries.
	 */
	private _pinnedLayoutEntries?: LayoutEntry[] = undefined;

	/**
	 * Gets or sets the unpinned layout entries.
	 */
	private _unpinnedLayoutEntries?: LayoutEntry[] = undefined;

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
		// If there are pinned layout entries, return the end of the last one.
		if (this._pinnedLayoutEntries?.length) {
			return this._pinnedLayoutEntries[this._pinnedLayoutEntries.length - 1].end;
		}

		// There are no pinned layout entries, return 0.
		return 0;
	}

	/**
	 * Gets the unpinned layout entries size.
	 */
	get unpinnedLayoutEntriesSize() {
		// If there are unpinned layout entries, return the end of the last one.
		if (this._unpinnedLayoutEntries?.length) {
			return this._unpinnedLayoutEntries[this._unpinnedLayoutEntries.length - 1].end;
		}

		// There are no unpinned layout entries, return 0.
		return 0;
	}

	/**
	 * Gets the number of pinned indexes.
	 */
	get pinnedIndexes() {
		return this._pinnedIndexes.size;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Sets the entries.
	 * @param entries The entries. This is either a count of the entries or an array of entry sizes.
	 */
	setEntries(entries: number | number[]) {
		// Set the entries.
		this._entries = entries;

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

		// If layout entries is an array, return the layout entry at the specified index.
		if (Array.isArray(this._unpinnedLayoutEntries)) {
			return this._unpinnedLayoutEntries[index];
		}

		// If there are no size overrides, we can calculate which layout entry to return.
		// Cache and return the layout entry.
		if (!this._customSizes.size) {
			// Return the layout entry.
			return new LayoutEntry(
				index,
				index * this._defaultSize,
				this._defaultSize
			);
		}

		// Calculate the start and size of the layout entry to return.
		const sortedSizeOverrides = this.sortedCustomSizes;
		let start = index * this._defaultSize;
		sortedSizeOverrides.some(sizeOverride => {
			// If the size override index is less than the index, adjust the start and return
			// false to continue the search.
			if (sizeOverride.index < index) {
				start = start - this._defaultSize + sizeOverride.customSize;
				return false;
			}

			// Return true to stop the search.
			return true;
		});

		// Return the layout entry.
		return new LayoutEntry(
			index,
			start,
			this._defaultSize,
			this._customSizes.get(index)
		);
	}

	/**
	 * Finds an unpinned layout entry.
	 * @param offset The offset of the unpinned layout entry to find.
	 * @returns The unpinned layout entry, if found; otherwise, undefined.
	 */
	findUnpinnedLayoutEntry(offset: number): ILayoutEntry | undefined {
		// Validate the offset.
		if (offset < 0) {
			return undefined;
		}

		// If there are no unpinned layout entries, return undefined.
		if (!this._unpinnedLayoutEntries) {
			return undefined;
		}

		//
		let leftIndex = 0;
		let rightIndex = this._unpinnedLayoutEntries.length - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle index and get the middle layout entry to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

			// Check if the middle layout entry contains the offset. If so, cache and return it.
			if (offset >= middleLayoutEntry.start && offset < middleLayoutEntry.end) {
				// Cache the layout entry and return its layout.
				return middleLayoutEntry;
			}

			// Setup the next binary search.
			if (middleLayoutEntry.start < offset) {
				leftIndex = middleIndex + 1;
			} else {
				rightIndex = middleIndex - 1;
			}
		}

		// Not found.
		return undefined;
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
		this._customSizes.set(index, overrideSize);

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
		this._customSizes.delete(index);

		// Update layout.
		this.updateLayout();
	}

	/**
	 * Returns the pinned layout entries.
	 * @returns An array of the pinned layout entries, if any; otherwise, undefined.
	 */
	pinnedLayoutEntries() {
		return this._pinnedLayoutEntries;
	}

	/**
	 * Returns the unpinned layout entries that overlap with the specified offset and width.
	 * @param offset The offset.
	 * @param width The width.
	 * @returns An array containing the unpinned layout entries, if any; otherwise, undefined.
	 */
	unpinnedLayoutEntries(offset: number, width: number): ILayoutEntry[] | undefined {
		// Validate the offset and width.
		if (offset < 0 || width <= 0) {
			return undefined;
		}

		// If there are no unpinned layout entries, return undefined.
		if (!this._unpinnedLayoutEntries) {
			return undefined;
		}

		// Perform a binary search to find the first unpinned layout entry that overlaps with the
		// specified offset and width.
		let leftIndex = 0;
		let rightIndex = this._unpinnedLayoutEntries.length - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle unpinned layout entry index and get the middle unpinned
			// layout entry to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

			// Check whether the middle unpinned layout entry contains the offset. If it does, it is
			// the first layout entry to return.
			if (offset >= middleLayoutEntry.start && offset < middleLayoutEntry.end) {
				// Add the middle unpinned layout entry to the layout entries to return.
				const layoutEntries: ILayoutEntry[] = [middleLayoutEntry];

				// Find the rest of the unpinned layout entries to return.
				for (let nextIndex = middleIndex + 1; nextIndex < this._unpinnedLayoutEntries.length; nextIndex++) {
					// Get the next unpinned layout entry.
					const layoutEntry = this._unpinnedLayoutEntries[nextIndex];

					// Break when the next unpinned layout entry starts after the offset + width.
					if (layoutEntry.start >= offset + width) {
						break;
					}

					// Add the next unpinned layout entry to the layout entries to return.
					layoutEntries.push(layoutEntry);
				}

				// Return the layout entries.
				return layoutEntries;
			}

			// Setup the next binary search.
			if (middleLayoutEntry.start < offset) {
				leftIndex = middleIndex + 1;
			} else {
				rightIndex = middleIndex - 1;
			}
		}

		// No unpinned layout entries that overlap with the specified offset and width were found.
		return undefined;
		// // If there are unpinned layout entries, find the ones that overlap with the specified offset
		// // and width and return them.
		// if (this._unpinnedLayoutEntries) {
		// 	// Perform a binary search to find the first unpinned layout entry that overlaps with the
		// 	// specified offset and width.
		// 	let leftIndex = 0;
		// 	let rightIndex = this._unpinnedLayoutEntries.length - 1;
		// 	while (leftIndex <= rightIndex) {
		// 		// Calculate the middle unpinned layout entry index and get the middle unpinned
		// 		// layout entry to check.
		// 		const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
		// 		const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

		// 		// Check whether the middle unpinned layout entry contains the offset. If it does, it is
		// 		// the first layout entry to return.
		// 		if (offset >= middleLayoutEntry.start && offset < middleLayoutEntry.end) {
		// 			// Add the middle unpinned layout entry to the layout entries to return.
		// 			const layoutEntries: ILayoutEntry[] = [middleLayoutEntry];

		// 			// Find the rest of the unpinned layout entries to return.
		// 			for (let nextIndex = middleIndex + 1; nextIndex < this._unpinnedLayoutEntries.length; nextIndex++) {
		// 				// Get the next unpinned layout entry.
		// 				const layoutEntry = this._unpinnedLayoutEntries[nextIndex];

		// 				// Break when the next unpinned layout entry starts after the offset + width.
		// 				if (layoutEntry.start >= offset + width) {
		// 					break;
		// 				}

		// 				// Add the next unpinned layout entry to the layout entries to return.
		// 				layoutEntries.push(layoutEntry);
		// 			}

		// 			// Return the layout entries.
		// 			return layoutEntries;
		// 		}

		// 		// Setup the next binary search.
		// 		if (middleLayoutEntry.start < offset) {
		// 			leftIndex = middleIndex + 1;
		// 		} else {
		// 			rightIndex = middleIndex - 1;
		// 		}
		// 	}

		// 	// No unpinned layout entries that overlap with the specified offset and width were found.
		// 	return undefined;
		// }

		// const layoutEntrySize = (index: number) => {
		// 	return this._customSizes.get(index) ?? this._defaultSize;
		// };

		// const unpinnedLayoutEntryStart = (index: number) => {
		// 	let start = 0;
		// 	for (let i = 0; i < index; i++) {
		// 		if (!this._pinnedIndexes.has(i)) {
		// 			start += layoutEntrySize(i);
		// 		}
		// 	}

		// 	return start;
		// };

		// // There are no unpinned layout entries, so we calculate which unpinned layout entries to return.
		// // Perform a binary search to find the first unpinned layout entry that overlaps with the
		// // specified offset and width.
		// let leftIndex = 0;
		// let rightIndex = this.entryCount - 1;
		// while (leftIndex <= rightIndex) {
		// 	// Calculate the middle index.
		// 	let middleIndex = Math.floor((leftIndex + rightIndex) / 2);

		// 	// If the middle index is pinned, skip it.
		// 	if (this._pinnedIndexes.has(middleIndex)) {

		// 		// Try left and right indexes to find an unpinned index.
		// 		let found = false;
		// 		let leftIndexToCheck = middleIndex - 1;
		// 		let rightIndexToCheck = middleIndex + 1;

		// 		// Find the next unpinned index.
		// 		while (leftIndexToCheck >= leftIndex || rightIndexToCheck <= rightIndex) {
		// 			if (leftIndexToCheck >= leftIndex && !this._pinnedIndexes.has(leftIndexToCheck)) {
		// 				middleIndex = leftIndexToCheck;
		// 				found = true;
		// 				break;
		// 			}
		// 			if (rightIndexToCheck <= rightIndex && !this._pinnedIndexes.has(rightIndexToCheck)) {
		// 				middleIndex = rightIndexToCheck;
		// 				found = true;
		// 				break;
		// 			}

		// 			// Adjust the left and right indexes to check.
		// 			leftIndexToCheck--;
		// 			rightIndexToCheck++;
		// 		}

		// 		// All indexes were pinned, so we cannot find an unpinned index.
		// 		if (!found) {
		// 			return undefined;
		// 		}
		// 	}


		// 	const start = unpinnedLayoutEntryStart(middleIndex);
		// 	const size = layoutEntrySize(middleIndex);
		// 	const end = start + size;

		// 	if (offset >= start && end < offset + width) {
		// 		// Add the middle unpinned layout entry to the layout entries to return.
		// 		const layoutEntries: ILayoutEntry[] = [new LayoutEntry(
		// 			middleIndex,
		// 			start,
		// 			this._defaultSize,
		// 			this._customSizes.get(middleIndex)
		// 		)];

		// 		// Find the rest of the unpinned layout entries to return.
		// 		for (let nextIndex = middleIndex + 1; nextIndex < this.entryCount; nextIndex++) {
		// 			// Get the next unpinned layout entry.
		// 			const layoutEntry = this._unpinnedlayoutEntries[nextIndex];

		// 			// Break when the next unpinned layout entry starts after the offset + width.
		// 			if (lauoutEntry.start >= offset + width) {
		// 				break;
		// 			}

		// 			// Add the next unpinned layout entry to the layout entries to return.
		// 			layoutEntries.push(lauoutEntry);
		// 		}

		// 		// Return the layout entries.
		// 		return layoutEntries;
		// 	}

		// 	// Setup the next binary search.
		// 	if (start < offset) {
		// 		leftIndex = middleIndex + 1;
		// 	} else {
		// 		rightIndex = middleIndex - 1;
		// 	}
		// }

		// // NO CUSTOM SIZES NO MEASURED SIZES.

		// // If there are no custom sizes, calculate which unpinned layout entries to return.
		// if (!this._customSizes.size) {
		// 	// Calculate the index of the first layout entry to return.
		// 	const firstIndex = Math.floor(offset / this._defaultSize);
		// 	if (firstIndex >= this.entryCount) {
		// 		return undefined;
		// 	}

		// 	// Add the first layout entry to the layout entries to return.
		// 	const layoutEntries: ILayoutEntry[] = [new LayoutEntry(
		// 		firstIndex,
		// 		firstIndex * this._defaultSize,
		// 		this._defaultSize
		// 	)];

		// 	// Find the rest of the layout entries that overlap with the specified offset and width.
		// 	for (let index = firstIndex + 1; index < this.entryCount; index++) {
		// 		if (!this._pinnedIndexes.has(index)) {
		// 			// Get the next layout entry.
		// 			const nextLayoutEntry = new LayoutEntry(
		// 				index,
		// 				index * this._defaultSize,
		// 				this._defaultSize
		// 			);

		// 			// If the next layout entry starts after the offset + width, break.
		// 			if (nextLayoutEntry.start >= offset + width) {
		// 				break;
		// 			}

		// 			// Add the next layout entry to the layout entries to return.
		// 			layoutEntries.push(nextLayoutEntry);
		// 		}
		// 	}

		// 	// Return the layout entries.
		// 	return layoutEntries;
		// }


		// // TODO
		// return undefined;


		// // If there are unpinned layout entries, filter them based on the offset and width.
		// if (this._unpinnedlayoutEntries) {
		// 	// Filter the unpinned layout entries based on the offset and width.
		// 	return this._unpinnedlayoutEntries.filter(unpinnedLayoutEntry =>
		// 		unpinnedLayoutEntry.end >= offset && unpinnedLayoutEntry.start <= offset + width
		// 	);
		// }

		// // Binary search.
		// return [];

	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Validates an index.
	 * @param index The index to validate.
	 * @returns true if the index is valid, false otherwise.
	 */
	private validateIndex(index: number) {
		return Number.isInteger(index) && index >= 0 && index < this.entryCount;
	}

	/**
	 * Updates layout.
	 */
	private updateLayout() {
		// Get the entry count.
		const entryCount = this.entryCount;

		// Remove pinned indexes that are beyond the entry count.
		for (const index of this._pinnedIndexes) {
			// If the pinned index is beyond the entry count, delete it.
			if (index >= entryCount) {
				this._pinnedIndexes.delete(index);
			}
		}

		// Remove custom sizes that are beyond the entry count.
		for (const index of this._customSizes.keys()) {
			// If the custom size index is beyond the entry count, delete it.
			if (index >= entryCount) {
				this._customSizes.delete(index);
			}
		}

		// If there are no pinned indexes, clear the pinned layout entries. Othwewise, create the pinned layout entries.
		if (!this._pinnedIndexes.size) {
			// Clear the pinned layout entries.
			this._pinnedLayoutEntries = undefined;
		} else {
			// Create the pinned layout entries.
			let start = 0;
			let outputIndex = 0;
			this._pinnedLayoutEntries = new Array<LayoutEntry>(this._pinnedIndexes.size);
			for (const pinnedIndex of this._pinnedIndexes) {
				// Create the pinned layout entry.
				const layoutEntry = new LayoutEntry(
					pinnedIndex,
					start,
					typeof this._entries === 'number' ? this._defaultSize : this._entries[pinnedIndex],
					this._customSizes.get(pinnedIndex)
				);

				// Add the pinned layout entry.
				this._pinnedLayoutEntries[outputIndex++] = layoutEntry;

				// Adjust the start for the next pinned layout entry.
				start += layoutEntry.size;
			}
		}

		// Create the unpinned layout entries.
		this._unpinnedLayoutEntries = new Array<LayoutEntry>(this.entryCount - this._pinnedIndexes.size);
		let start = 0;
		let outputIndex = 0;
		for (let index = 0; index < entryCount; index++) {
			// Skip pinned indexes.
			if (this._pinnedIndexes.has(index)) {
				continue;
			}

			// Create the unpinned layout entry.
			const layoutEntry = new LayoutEntry(
				index,
				start,
				typeof this._entries === 'number' ? this._defaultSize : this._entries[index],
				this._customSizes.get(index)
			);

			// Add the unpinned layout entry.
			this._unpinnedLayoutEntries[outputIndex++] = layoutEntry;

			// Adjust the start for the next unpinned layout entry.
			start += layoutEntry.size;
		}
	}

	//#endregion Private Methods
}
