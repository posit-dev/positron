/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Indexes class. Represents an ordered set of indexes.
 */
export class Indexes {
	/**
	 * Gets the values.
	 */
	readonly entries = new Set<number>();

	/**
	 * Constructor.
	 * @param indexes The initial indexes.
	 */
	constructor(indexes: number | number[]) {
		if (Array.isArray(indexes)) {
			indexes.forEach(index => this.entries.add(index));
		} else {
			this.entries.add(indexes);
		}
	}

	/**
	 * Determines whether the indexes has the specified index.
	 * @param index The index.
	 * @returns true, if the indexes has the specified index; otherwise, false.
	 */
	has(index: number) {
		return this.entries.has(index);
	}

	/**
	 * Gets the number of indexes.
	 */
	get size() {
		return this.entries.size;
	}

	/**
	 * Returns a value which indicates whether the indexes is empty.
	 * @returns true, if the indexes is empty; otherwise, false.
	 */
	isEmpty() {
		return this.entries.size === 0;
	}

	/**
	 * Adds the specified index to the indexes.
	 * @param index The index.
	 */
	add(index: number) {
		this.entries.add(index);
	}

	/**
	 * Deletes the specified index from the set of indexes.
	 * @param index The index.
	 * @return true if the index was deleted; otherwise, false.
	 */
	delete(index: number) {
		return this.entries.delete(index);
	}

	/**
	 * Returns the max index.
	 * @returns The max index.
	 */
	max() {
		return Math.max(...this.entries);
	}

	/**
	 * Returns the indexes as a sorted array.
	 * @returns The indexes as a sorted array.
	 */
	sortedArray() {
		return Array.from(this.entries).sort((a, b) => a - b);
	}
}
