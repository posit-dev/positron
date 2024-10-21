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
	 * Gets or sets the default width or the height of the column or row.
	 */
	defaultSize: number;

	/**
	 * Gets or sets the override width or the height of the column or row.
	 */
	overrideSize?: number;

	/**
	 * Gets the size of the column or row.
	 */
	get size() {
		return this.overrideSize ?? this.defaultSize;
	}

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
	 * @param defaultSize The default width or the height of the column or row.
	 * @param overrideSize The override width or the height of the column or row.
	 */
	constructor(index: number, start: number, defaultSize: number, overrideSize?: number) {
		this.index = index;
		this.start = start;
		this.defaultSize = defaultSize;
		this.overrideSize = overrideSize;
	}

	//#endregion Constructor
}

/**
 * ILayoutOverride interface.
 */
interface ILayoutOverride {
	/**
	 * Gets index of the column or row.
	 */
	readonly index: number;

	/**
	 * Gets the override size.
	 */
	readonly overrideSize: number;
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
	 * Gets or sets the layout entries. This is either a count of the layout entries or an array of
	 * the layout entries.
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

	//#region Public Properties

	/**
	 * Gets the size of the layout entries.
	 */
	get size() {
		// If the layout entries is an array, return the end of the last layout entry.
		if (Array.isArray(this._layoutEntries)) {
			return this._layoutEntries[this._layoutEntries.length - 1].end;
		}

		// Calculate the size of the layout entries.
		let size = this._layoutEntries * this._defaultSize;
		const sortedLayoutOverrides = this.getSortedLayoutOverrides();
		for (let index = 0; index < sortedLayoutOverrides.length; index++) {
			const layoutOverride = sortedLayoutOverrides[index];
			if (layoutOverride.index < this._layoutEntries) {
				size = size - this._defaultSize + layoutOverride.overrideSize;
			} else {
				break;
			}
		}

		// Return the size of the layout entries.
		return size;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Sets the layout entries.
	 * @param layoutEntries The layout entries.
	 */
	setLayoutEntries(layoutEntries: number | number[]) {
		// Clear the cached layout entry.
		this._cachedLayoutEntry = undefined;

		// If layout entries is a number, set it; otherwise, create and populate the layout entries
		// array from the supplied layout entries.
		if (!Array.isArray(layoutEntries)) {
			this._layoutEntries = layoutEntries;
			return;
		}

		// Create the layout entries array.
		this._layoutEntries = new Array<LayoutEntry>(layoutEntries.length);

		// Set the layout entries in the layout entries array.
		for (let index = 0, start = 0; index < layoutEntries.length; index++) {
			// Create the layout entry.
			const layoutEntry = new LayoutEntry(
				index,
				start,
				layoutEntries[index],
				this._layoutOverrides.get(index)
			);

			// Set the layout entry.
			this._layoutEntries[index] = layoutEntry;

			// Update the start for the next layout entry.
			start = layoutEntry.end;
		}
	}

	/**
	 * Clears a layout override.
	 * @param index The index of the layout override.
	 */
	clearLayoutOverride(index: number) {
		// Discard the cached layout entry, if it exists and its index is greater than the index of
		// the layout override being cleared.
		if (this._cachedLayoutEntry && this._cachedLayoutEntry.index >= index) {
			this._cachedLayoutEntry = undefined;
		}

		// Clear the layout override.
		this._layoutOverrides.delete(index);

		// Adjust the layout entries.
		if (Array.isArray(this._layoutEntries) && index < this._layoutEntries.length) {
			// Get the layout entry for the layout override being cleared and clear its override
			// size.
			const layoutEntry = this._layoutEntries[index];
			layoutEntry.overrideSize = undefined;

			// Adjust the start of the remaining layout entries.
			for (let i = index + 1, start = layoutEntry.end; i < this._layoutEntries.length; i++) {
				// Update the start of the layout entry.
				const layoutEntry = this._layoutEntries[i];
				layoutEntry.start = start;

				// Adjust the start for the next layout entry.
				start = layoutEntry.end;
			}
		}
	}

	/**
	 * Sets a layout override.
	 * @param index The index of the layout entry.
	 * @param overrideSize The override size of the layout entry.
	 */
	setLayoutOverride(index: number, overrideSize: number) {
		// Sanity check the index and size.
		if (!Number.isInteger(index) || index < 0 || overrideSize <= 0) {
			return;
		}

		// Discard the cached layout entry, if it exists and its index is greater than the index of
		// the layout override.
		if (this._cachedLayoutEntry && this._cachedLayoutEntry.index >= index) {
			this._cachedLayoutEntry = undefined;
		}

		// Set the layout override.
		this._layoutOverrides.set(index, overrideSize);

		// Adjust the layout entries.
		if (Array.isArray(this._layoutEntries) && index < this._layoutEntries.length) {
			// Get the layout entry that was overridden and set its override size.
			const layoutEntry = this._layoutEntries[index];
			layoutEntry.overrideSize = overrideSize;

			// Adjust the start of the remaining layout entries.
			for (let i = index + 1, start = layoutEntry.end; i < this._layoutEntries.length; i++) {
				// Update the start of the layout entry.
				const layoutEntry = this._layoutEntries[i];
				layoutEntry.start = start;

				// Adjust the start for the next layout entry.
				start = layoutEntry.end;
			}
		}
	}

	/**
	 * Gets a layout entry by index
	 * @param index The index.
	 * @returns The layout entry at the specified index, if found; otherwise, undefined.
	 */
	getLayoutEntry(index: number): ILayoutEntry | undefined {
		// Sanity check the index.
		if (index < 0) {
			return undefined;
		}

		// If we have the layout entry cached, return it.
		if (this._cachedLayoutEntry && this._cachedLayoutEntry.index === index) {
			return this._cachedLayoutEntry;
		}

		// If layout entries is an array, return the layout entry at the specified index.
		if (Array.isArray(this._layoutEntries)) {
			// Sanity check the index.
			if (index >= this._layoutEntries.length) {
				return undefined;
			}

			// Return the layout entry.
			return this._layoutEntries[index];
		}

		// Sanity check the index.
		if (index >= this._layoutEntries) {
			return undefined;
		}

		// If there are no layout overrides, we can calculate which layout entry to return.
		// Cache and return the layout entry.
		if (!this._layoutOverrides.size) {
			// Return the layout entry.
			return new LayoutEntry(
				index,
				index * this._defaultSize,
				this._defaultSize
			);
		}

		// Calculate the start and size of the layout entry to return.
		const sortedLayoutOverrides = this.getSortedLayoutOverrides();
		let start = index * this._defaultSize;
		sortedLayoutOverrides.some(layoutOverride => {
			// If the layout override index is less than the index, adjust the start and return
			// false to continue the search.
			if (layoutOverride.index < index) {
				start = start - this._defaultSize + layoutOverride.overrideSize;
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
			this._layoutOverrides.get(index)
		);
	}

	/**
	 * Finds a layout entry.
	 * @param offset The offset of the layout entry to find.
	 * @returns The layout entry, if found; otherwise, undefined.
	 */
	findLayoutEntry(offset: number): ILayoutEntry | undefined {
		// Sanity check the offset.
		if (offset < 0) {
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

			// Binary search the layout entries.
			let leftIndex = 0;
			let rightIndex = this._layoutEntries - 1;
			const sortedLayoutOverrides = this.getSortedLayoutOverrides();
			while (leftIndex <= rightIndex) {
				// Calculate the middle index.
				const middleIndex = Math.floor((leftIndex + rightIndex) / 2);

				// Calculate the start and size of the middle layout entry.
				let start = middleIndex * this._defaultSize;
				sortedLayoutOverrides.some(layoutOverride => {
					// If the layout override index is less than the middle index, adjust the start
					// and return false to continue the search.
					if (layoutOverride.index < middleIndex) {
						start = start - this._defaultSize + layoutOverride.overrideSize;
						return false;
					}

					// Return true to stop the search.
					return true;
				});

				// Check if the middle layout entry contains the offset. If so, cache and return it.
				if (offset >= start &&
					offset < start + (this._layoutOverrides.get(middleIndex) ?? this._defaultSize)
				) {
					// Cache and return the layout entry.
					return this._cachedLayoutEntry = new LayoutEntry(
						middleIndex,
						start,
						this._defaultSize,
						this._layoutOverrides.get(middleIndex)
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

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Gets the sorted layout overrides.
	 */
	private getSortedLayoutOverrides(): ILayoutOverride[] {
		return Array.from(this._layoutOverrides).
			map(([index, size]): ILayoutOverride => ({ index, overrideSize: size })).
			sort((a, b) => a.index - b.index);
	}

	//#endregion Private Methods
}
