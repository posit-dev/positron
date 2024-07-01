/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri as URI } from 'vscode';

// The ResourceMap class and its dependencies are copied as is from the core project.

interface ResourceMapKeyFn {
	(resource: URI): string;
}

class ResourceMapEntry<T> {
	constructor(readonly uri: URI, readonly value: T) { }
}

function isEntries<T>(arg: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [URI, T])[] | undefined): arg is readonly (readonly [URI, T])[] {
	return Array.isArray(arg);
}

export class ResourceMap<T> implements Map<URI, T> {

	private static readonly defaultToKey = (resource: URI) => resource.toString();

	readonly [Symbol.toStringTag] = 'ResourceMap';

	private readonly map: Map<string, ResourceMapEntry<T>>;
	private readonly toKey: ResourceMapKeyFn;

	/**
	 *
	 * @param toKey Custom uri identity function, e.g use an existing `IExtUri#getComparison`-util
	 */
	constructor(toKey?: ResourceMapKeyFn);

	/**
	 *
	 * @param other Another resource which this maps is created from
	 * @param toKey Custom uri identity function, e.g use an existing `IExtUri#getComparison`-util
	 */
	constructor(other?: ResourceMap<T>, toKey?: ResourceMapKeyFn);

	/**
	 *
	 * @param other Another resource which this maps is created from
	 * @param toKey Custom uri identity function, e.g use an existing `IExtUri#getComparison`-util
	 */
	constructor(entries?: readonly (readonly [URI, T])[], toKey?: ResourceMapKeyFn);

	constructor(arg?: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [URI, T])[], toKey?: ResourceMapKeyFn) {
		if (arg instanceof ResourceMap) {
			this.map = new Map(arg.map);
			this.toKey = toKey ?? ResourceMap.defaultToKey;
		} else if (isEntries(arg)) {
			this.map = new Map();
			this.toKey = toKey ?? ResourceMap.defaultToKey;

			for (const [resource, value] of arg) {
				this.set(resource, value);
			}
		} else {
			this.map = new Map();
			this.toKey = arg ?? ResourceMap.defaultToKey;
		}
	}

	set(resource: URI, value: T): this {
		this.map.set(this.toKey(resource), new ResourceMapEntry(resource, value));
		return this;
	}

	get(resource: URI): T | undefined {
		return this.map.get(this.toKey(resource))?.value;
	}

	has(resource: URI): boolean {
		return this.map.has(this.toKey(resource));
	}

	get size(): number {
		return this.map.size;
	}

	clear(): void {
		this.map.clear();
	}

	delete(resource: URI): boolean {
		return this.map.delete(this.toKey(resource));
	}

	forEach(clb: (value: T, key: URI, map: Map<URI, T>) => void, thisArg?: any): void {
		if (typeof thisArg !== 'undefined') {
			clb = clb.bind(thisArg);
		}
		for (const [_, entry] of this.map) {
			clb(entry.value, entry.uri, <any>this);
		}
	}

	*values(): IterableIterator<T> {
		for (const entry of this.map.values()) {
			yield entry.value;
		}
	}

	*keys(): IterableIterator<URI> {
		for (const entry of this.map.values()) {
			yield entry.uri;
		}
	}

	*entries(): IterableIterator<[URI, T]> {
		for (const entry of this.map.values()) {
			yield [entry.uri, entry.value];
		}
	}

	*[Symbol.iterator](): IterableIterator<[URI, T]> {
		for (const [, entry] of this.map) {
			yield [entry.uri, entry.value];
		}
	}
}
