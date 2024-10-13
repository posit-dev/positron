/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ILayoutEntry interface.
 */
export interface ILayoutEntry {
	/**
	 * Gets index of the column or row.
	 */
	readonly index: number;

	/**
	 * Gets the X or Y coordinate of the column or row.
	 */
	readonly start: number;

	/**
	 * Gets the width or the height of the column or row.
	 */
	readonly size: number;

	/**
	 * Gets the end of the column or row.
	 */
	readonly end: number;
}

/**
 * LayoutEntry class.
 */
class LayoutEntry implements ILayoutEntry {
	//#region Public Properties

	/**
	 * Gets index of the column or row.
	 */
	readonly index: number;

	/**
	 * Gets or sets the X or Y coordinate of the column or row.
	 */
	start: number;

	/**
	 * Gets or sets the width or the height of the column or row.
	 */
	size: number;

	/**
	 * Gets the end of the column or row.
	 */
	get end() {
		return this.start + this.size;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param index The index of the column or row.
	 * @param start The X or Y coordinate of the column or row.
	 * @param size The width or the height of the column or row.
	 */
	constructor(index: number, start: number, size: number) {
		this.index = index;
		this.start = start;
		this.size = size;
	}

	//#endregion Constructor
}

/**
 * LayoutOverride interface.
 */
interface LayoutOverride {
	index: number;
	size: number;
}

/**
 * LayoutManager class.
 */
export class LayoutManager {
	//#region Private Properties

	/**
	 * Gets the	default size.
	 */
	private readonly _defaultSize: number = 0;

	/**
	 * Gets or sets the layout entries.
	 */
	private _layoutEntries: number | LayoutEntry[] = 0;

	/**
	 * Gets or sets the layout overrides.
	 */
	private _layoutOverrides = new Map<number, number>();

	/**
	 * Gets or sets the cached layout entry.
	 */
	private _cachedLayoutEntry?: LayoutEntry;

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

	//#region Public Methods

	/**
	 * Sets the layout entries.
	 * @param layoutEntries The layout entries.
	 */
	setLayoutEntries(layoutEntries: number | number[]) {
		// If layout entries is a number, set it; otherwise, create and populate the layout entries
		// array from the supplied layout entries.
		if (!Array.isArray(layoutEntries)) {
			this._layoutEntries = layoutEntries;
		} else {
			// Create the layout entries array.
			this._layoutEntries = new Array<LayoutEntry>(layoutEntries.length);

			// Add the layout entries to the layout entries array.
			for (let index = 0, start = 0; index < layoutEntries.length; index++) {
				// Get the size of the layout entry.
				const size = this._layoutOverrides.get(index) ?? layoutEntries[index];

				// Set the layout entry.
				this._layoutEntries[index] = new LayoutEntry(index, start, size);

				// Update the start for the next layout entry.
				start += size;
			}
		}
	}

	/**
	 * Sets a layout override.
	 * @param index The index of the layout entry.
	 * @param size The size of the layout entry.
	 */
	setLayoutOverride(index: number, size: number) {
		// Sanity check the index and size.
		if (!Number.isInteger(index) || index < 0 || !Number.isInteger(size) || size <= 0) {
			return;
		}

		// Discard the cached layout entry, if it exists and its index is greater than the index of
		// the layout override.
		if (this._cachedLayoutEntry && this._cachedLayoutEntry.index >= index) {
			this._cachedLayoutEntry = undefined;
		}

		// Set the layout override.
		this._layoutOverrides.set(index, size);

		// If layout entries is a number, return.
		if (!Array.isArray(this._layoutEntries)) {
			return;
		}

		// Adjust the layout entries.
		if (index < this._layoutEntries.length) {
			// Update the size of the layout entry that was overridden.
			const layoutEntry = this._layoutEntries[index];
			layoutEntry.size = size;

			// Adjust the start of the remaining layout entries.
			for (let i = index + 1, start = layoutEntry.end; i < this._layoutEntries.length; i++) {
				// Update the start of the layout entry.
				const layoutEntry = this._layoutEntries[i];
				layoutEntry.start = start;

				// Adjust the start for the next layout entry.
				start += layoutEntry.size;
			}
		}
	}

	/**
	 * Finds a layout entry.
	 * @param offset The offset of the layout entry to find.
	 * @returns The layout entry, if found; otherwise, undefined.
	 */
	findLayoutEntry(offset: number): ILayoutEntry | undefined {
		// Sanity check the offset.
		if (!Number.isInteger(offset) || offset < 0) {
			return undefined;
		}

		// See if the layout entry is cached. If it is, return it.
		if (this._cachedLayoutEntry) {
			if (offset >= this._cachedLayoutEntry.start && offset < this._cachedLayoutEntry.end) {
				return this._cachedLayoutEntry;
			}
		}

		// Find the layout entry to return.
		if (!Array.isArray(this._layoutEntries)) {
			// If there are no layout overrides, we can calculate which layout entry to return.
			if (!this._layoutOverrides.size) {
				// Calculate the layout entry index to return. If it's beyond the number of layout
				// entries, return undefined.
				const index = Math.floor(offset / this._defaultSize);
				if (index >= this._layoutEntries) {
					return undefined;
				}

				// Cache and return the layout entry.
				return this._cachedLayoutEntry = new LayoutEntry(
					index,
					index * this._defaultSize,
					this._defaultSize
				);
			}

			// Binary search layout entries.
			let leftIndex = 0;
			let rightIndex = this._layoutEntries - 1;
			const layoutOverrides = Array.from(this._layoutOverrides).
				map<LayoutOverride>(([index, size]) => ({ index, size })).
				sort((a, b) => a.index - b.index);
			while (leftIndex <= rightIndex) {
				// Calculate the middle index.
				const middleIndex = Math.floor((leftIndex + rightIndex) / 2);

				// Calculate the start and size of the middle layout entry.
				let start = middleIndex * this._defaultSize;
				layoutOverrides.some(layoutOverride => {
					// If the index is less than the middle index, adjust the start and return false
					// to continue the search.
					if (layoutOverride.index < middleIndex) {
						start = start - this._defaultSize + layoutOverride.size;
						return false;
					}

					// Return true to stop the search.
					return true;
				});
				const size = this._layoutOverrides.get(middleIndex) ?? this._defaultSize;

				// Check if the middle layout entry contains the offset. If so, cache and return it.
				if (offset >= start && offset < start + size) {
					// Cache and return the layout entry.
					return this._cachedLayoutEntry = new LayoutEntry(
						middleIndex,
						start,
						size
					);
				}

				// Setup the next binary chop.
				if (start < offset) {
					leftIndex = middleIndex + 1;
				} else {
					rightIndex = middleIndex - 1;
				}
			}

			// Not found.
			return undefined;
		} else {
			// Binary search the array of layout entries.
			let leftIndex = 0;
			let rightIndex = this._layoutEntries.length - 1;
			while (leftIndex <= rightIndex) {
				// Calculate the middle index and get the middle layout entry to check.
				const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
				const middleLayoutEntry = this._layoutEntries[middleIndex];

				// Check if the middle layout entry contains the offset. If so, cache and return it.
				if (offset >= middleLayoutEntry.start && offset < middleLayoutEntry.end) {
					// Cache the layout entry and return its layout.
					return this._cachedLayoutEntry = middleLayoutEntry;
				}

				// Setup the next binary chop.
				if (middleLayoutEntry.start < offset) {
					leftIndex = middleIndex + 1;
				} else {
					rightIndex = middleIndex - 1;
				}
			}

			// Not found.
			return undefined;
		}
	}
}
