/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { ConnectClient, PinInfo } from './connectClient.js';
import { Logger, NULL_LOGGER } from './logging.js';
import { createOwnerNode, IPinsBrowseHost } from './pinsNodes.js';

/**
 * A live connection to a Posit Connect server's pins, implementing the DataConnection interface.
 *
 * There is no persistent socket: each browse action is a stateless HTTPS request carrying the API
 * key. Each top-level browse re-enumerates the pins (the connection is torn down and rebuilt when
 * its tree entry is collapsed and re-expanded, so there is nothing to cache across); a successful
 * per-pin type lookup is memoized because an owner node can be collapsed and re-expanded without
 * disconnecting, while a failed one is retried on the next re-expand.
 */
export class PinsConnection implements positron.DataConnection, IPinsBrowseHost {
	/** Set once disconnected, so browsing after disconnect fails cleanly. */
	private _disconnected = false;

	/** Per-pin type lookups, keyed by GUID, so a pin's `data.txt` is fetched at most once on success. */
	private readonly _typeCache = new Map<string, Promise<string | undefined>>();

	/**
	 * @param _client The Connect client, already validated by the driver's connect().
	 * @param _logger Logs browse activity; defaults to a no-op logger.
	 */
	constructor(
		private readonly _client: ConnectClient,
		private readonly _logger: Logger = NULL_LOGGER
	) { }

	/** Pins are browsed read-only; writing pins is out of scope for this driver. */
	async isReadOnly(): Promise<boolean> {
		return true;
	}

	/**
	 * Returns the top-level nodes: one per owner that has at least one visible pin, sorted
	 * alphabetically. Each owner node expands to that owner's pins.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		const pins = await this._client.listPins();

		const pinsByOwner = new Map<string, PinInfo[]>();
		for (const pin of pins) {
			const owner = pinsByOwner.get(pin.ownerUsername);
			if (owner) {
				owner.push(pin);
			} else {
				pinsByOwner.set(pin.ownerUsername, [pin]);
			}
		}

		this._logger.info(`Browsing ${pins.length} pin(s) across ${pinsByOwner.size} owner(s)`);
		return [...pinsByOwner.keys()]
			.sort((a, b) => a.localeCompare(b))
			.map(owner => createOwnerNode(this, owner, pinsByOwner.get(owner)!));
	}

	/**
	 * Resolves a pin's storage type for the badge. A successful lookup is memoized; a failed one is
	 * dropped from the cache (matching the enumeration's retry-rather-than-cache-rejections behavior)
	 * so a later re-expand retries it, and shows no badge in the meantime rather than failing the
	 * whole owner expansion.
	 */
	async getPinType(pin: PinInfo): Promise<string | undefined> {
		let typePromise = this._typeCache.get(pin.guid);
		if (!typePromise) {
			typePromise = this._client.getPinMeta(pin.guid, pin.activeBundleId)
				.then(meta => meta.type || undefined);
			this._typeCache.set(pin.guid, typePromise);
		}
		try {
			return await typePromise;
		} catch {
			// The lookup failed: drop it so a later re-expand retries, and show no badge this time.
			this._typeCache.delete(pin.guid);
			return undefined;
		}
	}

	/** Marks the connection disconnected and drops cached state. No socket to close. */
	async disconnect(): Promise<void> {
		this._disconnected = true;
		this._typeCache.clear();
	}

	/** Whether the connection is still usable. */
	async isConnected(): Promise<boolean> {
		return !this._disconnected;
	}

	/** Throws if the connection has been disconnected. */
	private _ensureConnected(): void {
		if (this._disconnected) {
			throw new Error('Connection is closed');
		}
	}
}
