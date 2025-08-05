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
	 * Gets or sets the pinned layout entries.
	 */
	private _pinnedLayoutEntries: LayoutEntry[] = [];

	/**
	 * Gets or sets the unpinned layout entries.
	 */
	private _unpinnedLayoutEntries: LayoutEntry[] = [];

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
		if (this._pinnedLayoutEntries.length) {
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
		if (this._unpinnedLayoutEntries.length) {
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

		// If the index is pinned, return the pinned layout entry.
		if (this._pinnedIndexes.has(index)) {
			// Get the pinned indexes as an array.
			const pinnedIndexesArray = Array.from(this._pinnedIndexes);

			// Get the pinned index position.
			const pinnedIndexPosition = pinnedIndexesArray.indexOf(index);

			// This can't happen. We know for certain that the index is pinned.
			if (pinnedIndexPosition === -1) {
				return undefined;
			}

			// Return the pinned layout entry at the specified index.
			return this._pinnedLayoutEntries[pinnedIndexPosition];
		}

		// Get the unpinned index position.
		const unpinnedIndexPosition = this.unpinnedIndexPosition(index);

		// If the unpinned index position is undefined, it indicate that there is a bug. Just return undefined.
		if (unpinnedIndexPosition === undefined) {
			return undefined;
		}

		return this._unpinnedLayoutEntries[unpinnedIndexPosition];


		// // If layout entries is an array, return the layout entry at the specified index.
		// if (Array.isArray(this._unpinnedLayoutEntries)) {
		// 	return this._unpinnedLayoutEntries[index];
		// }

		// // If there are no size overrides, we can calculate which layout entry to return.
		// if (!this._customSizes.size) {
		// 	// Return the layout entry.
		// 	return new LayoutEntry(
		// 		index,
		// 		index * this._defaultSize,
		// 		this._defaultSize
		// 	);
		// }

		// // Calculate the start and size of the layout entry to return.
		// const sortedSizeOverrides = this.sortedCustomSizes;
		// let start = index * this._defaultSize;
		// sortedSizeOverrides.some(sizeOverride => {
		// 	// If the size override index is less than the index, adjust the start and return
		// 	// false to continue the search.
		// 	if (sizeOverride.index < index) {
		// 		start = start - this._defaultSize + sizeOverride.customSize;
		// 		return false;
		// 	}

		// 	// Return true to stop the search.
		// 	return true;
		// });

		// // Return the layout entry.
		// return new LayoutEntry(
		// 	index,
		// 	start,
		// 	this._defaultSize,
		// 	this._customSizes.get(index)
		// );
	}

	/**
	 * Finds an unpinned layout entry at the specified offset.
	 * @param offset The offset of the unpinned layout entry to find.
	 * @returns The unpinned layout entry, if found; otherwise, undefined.
	 */
	findUnpinnedLayoutEntry(offset: number): ILayoutEntry | undefined {
		// Validate the offset.
		if (offset < 0) {
			return undefined;
		}

		// If there are no unpinned layout entries, return undefined.
		if (!this._unpinnedLayoutEntries.length) {
			return undefined;
		}

		// Perform a binary search to find the unpinned layout entry at the specified offset.
		let leftIndex = 0;
		let rightIndex = this._unpinnedLayoutEntries.length - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle index and get the middle layout entry to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

			// Check if the middle layout entry contains the offset. If so, return it.
			if (offset >= middleLayoutEntry.start && offset < middleLayoutEntry.end) {
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
	 * Returns the unpinned layout entries that overlap with the specified offset and size.
	 * @param offset The offset.
	 * @param size The size.
	 * @returns An array containing the unpinned layout entries, if any; otherwise, undefined.
	 */
	unpinnedLayoutEntries(offset: number, size: number): ILayoutEntry[] {
		// Validate the offset and size.
		if (offset < 0 || size <= 0) {
			return [];
		}

		// If there are no unpinned layout entries, return undefined.
		if (!this._unpinnedLayoutEntries.length) {
			return [];
		}

		// Perform a binary search to find the unpinned layout entries at the specified offset and size.
		let leftIndex = 0;
		let rightIndex = this._unpinnedLayoutEntries.length - 1;
		while (leftIndex <= rightIndex) {
			// Calculate the middle index and get the middle layout entry to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const middleLayoutEntry = this._unpinnedLayoutEntries[middleIndex];

			// Check whether the middle unpinned layout entry contains the offset. If it does, it is
			// the first layout entry to return.
			if (offset >= middleLayoutEntry.start && offset <= middleLayoutEntry.end) {
				// Add the middle unpinned layout entry to the layout entries to return.
				const layoutEntries: ILayoutEntry[] = [middleLayoutEntry];

				// Find the rest of the unpinned layout entries to return.
				for (let nextIndex = middleIndex + 1; nextIndex < this._unpinnedLayoutEntries.length; nextIndex++) {
					// Get the next unpinned layout entry.
					const layoutEntry = this._unpinnedLayoutEntries[nextIndex];

					// Break when the next unpinned layout entry starts after the offset + size.
					if (layoutEntry.start >= offset + size) {
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

		// No unpinned layout entries that overlap with the specified offset and size were found.
		return [];
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

		if (this._pinnedLayoutEntries.length) {
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
		// If the index is pinned, return the next pinned index, if there is one.
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

			// Return the first unpinned index.
			if (this._unpinnedLayoutEntries.length) {
				return this._unpinnedLayoutEntries[0].index;
			} else {
				// There are no unpinned layout entries, so there is no next index.
				return undefined;
			}
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
		return Number.isInteger(index) && index >= 0 && index < this.entryCount;
	}

	private unpinnedIndexPosition(index: number): number | undefined {
		// Perform a binary search to find the unpinned layout entry with specified offset.
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
			this._pinnedLayoutEntries = [];
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
