/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { BundleInfo, PinInfo } from './connectClient.js';
import { isPreviewablePinType } from './pinTypes.js';

/**
 * The maximum number of `data.txt` requests made in parallel when resolving the type badges for an
 * owner's pins. Owner expansion is lazy and pins-per-owner counts are usually small, so a modest
 * cap keeps a large owner from opening a burst of connections.
 */
const MAX_METADATA_CONCURRENCY = 8;

/**
 * The capability the node factories need from the connection: resolving a pin's storage type (for
 * the type badge). Implemented by PinsConnection.
 */
export interface IPinsBrowseHost {
	/**
	 * Resolves a pin's storage type (e.g. 'parquet', 'csv') for the type badge, or undefined when it
	 * cannot be determined. Resilient: a failure to read a pin's metadata yields undefined rather
	 * than failing the whole owner expansion.
	 */
	getPinType(pin: PinInfo): Promise<string | undefined>;

	/** Lists a pin's versions (bundles), newest first, when the pin node is expanded. */
	getBundles(pin: PinInfo): Promise<BundleInfo[]>;

	/**
	 * Opens a pin version's tabular data in the Data Explorer: downloads the version's data file
	 * (cached), loads it into DuckDB, and opens the explorer over it. Only invoked for previewable pin
	 * types (see {@link isPreviewablePinType}).
	 *
	 * @param pin The pin.
	 * @param bundleId The bundle (version) id whose data to preview.
	 * @param isActiveVersion Whether `bundleId` is the pin's active version; the active version reads
	 * as the latest, so its generated code omits the explicit `version` argument.
	 */
	previewPin(pin: PinInfo, bundleId: string, isActiveVersion: boolean): Promise<void>;
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
 * Creates an owner node: a grouping of one user's pins, rendered with an account (person) icon.
 * Expanding it lists that owner's pins, sorted by name, each annotated with its storage type.
 *
 * @param host The browse host used to resolve pin types on expansion.
 * @param ownerUsername The owner's username (the node's display name).
 * @param pins The owner's pins.
 */
export function createOwnerNode(host: IPinsBrowseHost, ownerUsername: string, pins: readonly PinInfo[]): positron.DataConnectionNode {
	return {
		name: ownerUsername,
		kind: positron.DataConnectionNodeKind.Owner,
		async getChildren() {
			const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name));
			const types = await mapWithConcurrency(sorted, MAX_METADATA_CONCURRENCY, pin => host.getPinType(pin));
			return sorted.map((pin, index) => createPinNode(host, pin, types[index]));
		},
	};
}

/**
 * Creates a pin node. Expanding it lists the pin's versions (bundles), newest first. A previewable
 * pin (a tabular type; see {@link isPreviewablePinType}) can be opened in the Data Explorer, which
 * previews its active version. The type badge shows the pin's storage format when known.
 *
 * @param host The browse host used to list versions and open the preview.
 * @param pin The pin.
 * @param type The pin's storage type for the badge, or undefined when unknown.
 */
export function createPinNode(host: IPinsBrowseHost, pin: PinInfo, type: string | undefined): positron.DataConnectionNode {
	return {
		name: pin.name,
		kind: positron.DataConnectionNodeKind.Pin,
		dataType: type,
		async getChildren() {
			const bundles = await host.getBundles(pin);
			return bundles.map(bundle => createVersionNode(host, pin, type, bundle));
		},
		// A previewable pin opens its active version in the Data Explorer.
		preview: isPreviewablePinType(type)
			? () => host.previewPin(pin, pin.activeBundleId, true)
			: undefined,
	};
}

/**
 * Creates a version node: one bundle of a pin. A version of a previewable pin can be opened in the
 * Data Explorer (that specific version's data); other versions are leaves. The active (currently
 * served) version is flagged with an "active" badge; the name pairs the creation time with the
 * bundle id, e.g. "2024-01-15 09:30 (#421)".
 *
 * @param host The browse host used to open the preview.
 * @param pin The pin this version belongs to.
 * @param type The pin's storage type, used to decide whether the version is previewable.
 * @param bundle The bundle (version).
 */
export function createVersionNode(host: IPinsBrowseHost, pin: PinInfo, type: string | undefined, bundle: BundleInfo): positron.DataConnectionNode {
	const timestamp = formatBundleTimestamp(bundle.createdTime);
	return {
		name: timestamp ? `${timestamp} (#${bundle.id})` : `#${bundle.id}`,
		kind: positron.DataConnectionNodeKind.Version,
		dataType: bundle.active ? 'active' : undefined,
		preview: isPreviewablePinType(type)
			? () => host.previewPin(pin, bundle.id, bundle.active)
			: undefined,
	};
}

/**
 * Formats a bundle's ISO 8601 creation timestamp as "YYYY-MM-DD HH:MM" in UTC, for stable,
 * timezone-unambiguous version labels. Returns an empty string when the timestamp is missing or
 * unparseable, so the caller can fall back to a bare bundle id.
 */
function formatBundleTimestamp(iso: string): string {
	const date = new Date(iso);
	if (iso === '' || isNaN(date.getTime())) {
		return '';
	}
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
