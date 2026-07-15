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
 * key. The connection caches the single pin enumeration (so grouping and re-expansion don't refetch
 * it) and memoizes per-pin type lookups.
 */
export class PinsConnection implements positron.DataConnection, IPinsBrowseHost {
	/** Set once disconnected, so browsing after disconnect fails cleanly. */
	private _disconnected = false;

	/** The cached pin enumeration, shared across owner grouping and re-expansion. */
	private _pinsPromise?: Promise<PinInfo[]>;

	/** Per-pin type lookups, keyed by GUID, so a pin's `data.txt` is fetched at most once. */
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
		const pins = await this.listPins();

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
	 * Lists the visible pins, fetching once and caching for the life of the connection. A failed
	 * enumeration (timeout, network blip) is not cached: the rejected promise is dropped so a later
	 * expand retries, rather than replaying the same failure until the connection is recreated.
	 */
	async listPins(): Promise<PinInfo[]> {
		this._ensureConnected();
		let pinsPromise = this._pinsPromise;
		if (!pinsPromise) {
			pinsPromise = this._client.listPins();
			this._pinsPromise = pinsPromise;
			try {
				await pinsPromise;
			} catch (err) {
				// Only the creator clears the cache; concurrent callers that awaited the same promise
				// just see the rejection. A subsequent expand starts a fresh fetch.
				this._pinsPromise = undefined;
				throw err;
			}
		}
		return pinsPromise;
	}

	/** Resolves a pin's storage type for the badge, memoized and resilient to metadata failures. */
	async getPinType(pin: PinInfo): Promise<string | undefined> {
		let typePromise = this._typeCache.get(pin.guid);
		if (!typePromise) {
			typePromise = (async () => {
				try {
					const meta = await this._client.getPinMeta(pin.guid, pin.activeBundleId);
					return meta.type || undefined;
				} catch {
					// A pin whose metadata can't be read simply shows no type badge.
					return undefined;
				}
			})();
			this._typeCache.set(pin.guid, typePromise);
		}
		return typePromise;
	}

	/** Marks the connection disconnected and drops cached state. No socket to close. */
	async disconnect(): Promise<void> {
		this._disconnected = true;
		this._pinsPromise = undefined;
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
