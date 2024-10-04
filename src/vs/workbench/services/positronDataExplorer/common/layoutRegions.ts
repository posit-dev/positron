/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LayoutRegion interface.
 */
export interface LayoutRegion {
	/**
	 * Gets the X or Y coordinate of the column or row.
	 */
	readonly start: number;

	/**
	 * Gets the width or the height of the column or row.
	 */
	readonly size: number;

	/**
	 * Gets index of the column or row.
	 */
	readonly index: number;
}

/**
 * CachedLayoutRegion interface.
 */
interface CachedLayoutRegion {
	/**
	 * Gets the value.
	 */
	readonly value: number;

	/**
	 * Gets the layout region.
	 */
	readonly layoutRegion: LayoutRegion;
}

/**
 * LayoutRegions class.
 */
export class LayoutRegions {
	//#region Private Properties

	/**
	 * Gets or sets the layout regions.
	 */
	private _layoutRegions: LayoutRegion[] = [];

	/**
	 * Gets or sets the cached layout region.
	 */
	private _cachedLayoutRegion?: CachedLayoutRegion;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 */
	constructor() {
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets the extent of the layout regions.
	 */
	get extent() {
		if (!this._layoutRegions.length) {
			return 0;
		} else {
			const lastRegion = this._layoutRegions[this._layoutRegions.length - 1];
			return lastRegion.start + lastRegion.size;
		}
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Clears the layout regions.
	 */
	clear() {
		this._layoutRegions = [];
		this._cachedLayoutRegion = undefined;
	}

	/**
	 * Appends a layout region.
	 * @param layoutRegion The layout region to append.
	 */
	append(layoutRegion: LayoutRegion) {
		this._layoutRegions.push(layoutRegion);
	}

	/**
	 * Finds a layout region by value.
	 * @param value The value to find.
	 * @returns The layout region, if found; otherwise, undefined.
	 */
	find(value: number): LayoutRegion | undefined {
		// If we have the layout region cached, return it.
		if (this._cachedLayoutRegion?.value === value) {
			console.log(`Returning cached layout region for value ${value}`);
			return this._cachedLayoutRegion.layoutRegion;
		}

		// Setup the binary search.
		let leftIndex = 0;
		let rightIndex = this._layoutRegions.length - 1;

		// Binary search.
		while (leftIndex <= rightIndex) {
			// Set the middle index and get the layout region to check.
			const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
			const layoutRegion = this._layoutRegions[middleIndex];

			// Check for a match.
			if (value >= layoutRegion.start && value < layoutRegion.start + layoutRegion.size) {
				// Cache the layout region.
				this._cachedLayoutRegion = {
					value,
					layoutRegion
				};

				console.log(`Returning layout region for value ${value}`);

				// Return the layout region.
				return layoutRegion;
			}

			// Setup the next binary chop.
			if (layoutRegion.start < value) {
				leftIndex = middleIndex + 1;
			} else {
				rightIndex = middleIndex - 1;
			}
		}

		// Not found.
		return undefined;
	}

	//#endregion Public Methods
}
