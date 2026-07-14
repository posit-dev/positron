/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { PinInfo } from './connectClient.js';

/**
 * The maximum number of `data.txt` requests made in parallel when resolving the type badges for an
 * owner's pins. Owner expansion is lazy and pins-per-owner counts are usually small, so a modest
 * cap keeps a large owner from opening a burst of connections.
 */
const MAX_METADATA_CONCURRENCY = 8;

/**
 * The capabilities the node factories need from the connection: enumerating pins and resolving a
 * pin's storage type (for the type badge). Implemented by PinsConnection.
 */
export interface IPinsBrowseHost {
	/** Lists all pins visible to the connection, grouped later by owner. */
	listPins(): Promise<PinInfo[]>;
	/**
	 * Resolves a pin's storage type (e.g. 'parquet', 'csv') for the type badge, or undefined when it
	 * cannot be determined. Resilient: a failure to read a pin's metadata yields undefined rather
	 * than failing the whole owner expansion.
	 */
	getPinType(pin: PinInfo): Promise<string | undefined>;
}

/**
 * Maps over `items` running at most `limit` calls to `fn` concurrently, preserving input order in
 * the results. Used to fetch pin type badges without opening one request per pin all at once.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) {
				return;
			}
			results[index] = await fn(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

/**
 * Creates an owner node: a grouping of one user's pins. Rendered with the schema icon, since an
 * owner is a namespace-like grouping. Expanding it lists that owner's pins, sorted by name, each
 * annotated with its storage type.
 *
 * @param host The browse host used to resolve pin types on expansion.
 * @param ownerUsername The owner's username (the node's display name).
 * @param pins The owner's pins.
 */
export function createOwnerNode(host: IPinsBrowseHost, ownerUsername: string, pins: readonly PinInfo[]): positron.DataConnectionNode {
	return {
		name: ownerUsername,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name));
			const types = await mapWithConcurrency(sorted, MAX_METADATA_CONCURRENCY, pin => host.getPinType(pin));
			return sorted.map((pin, index) => createPinNode(pin, types[index]));
		},
	};
}

/**
 * Creates a pin node. In PR 1 pins are leaves: no children and no preview (previewing tabular pins
 * in the Data Explorer comes in a later PR). The type badge shows the pin's storage format when
 * known.
 *
 * @param pin The pin.
 * @param type The pin's storage type for the badge, or undefined when unknown.
 */
export function createPinNode(pin: PinInfo, type: string | undefined): positron.DataConnectionNode {
	return {
		name: pin.name,
		kind: positron.DataConnectionNodeKind.Pin,
		dataType: type,
	};
}
