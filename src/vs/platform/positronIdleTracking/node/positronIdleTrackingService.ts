/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronIdleInfo, IPositronIdleTrackingService } from '../common/positronIdleTracking.js';

/**
 * Server-side implementation that aggregates activity reports from browser
 * clients. Each client is identified by a unique ID (typically the
 * reconnection token) and reports its last-activity timestamp over IPC.
 */
export class PositronIdleTrackingService implements IPositronIdleTrackingService {
	declare readonly _serviceBrand: undefined;

	/** Map of clientId to last-activity epoch milliseconds. */
	private readonly _clients = new Map<string, number>();

	/** Epoch milliseconds when the server started, used as fallback. */
	private readonly _serverStartMs = Date.now();

	reportActivity(clientId: string, timestampMs: number): void {
		const existing = this._clients.get(clientId);
		// Only accept timestamps that move forward to avoid clock skew issues.
		if (existing === undefined || timestampMs > existing) {
			this._clients.set(clientId, timestampMs);
		}
	}

	removeClient(clientId: string): void {
		this._clients.delete(clientId);
	}

	getIdleInfo(): IPositronIdleInfo {
		let lastActivityEpochMs = this._serverStartMs;
		for (const ts of this._clients.values()) {
			if (ts > lastActivityEpochMs) {
				lastActivityEpochMs = ts;
			}
		}

		const secondsIdle = Math.max(0, Math.floor((Date.now() - lastActivityEpochMs) / 1000));

		return {
			secondsIdle,
			lastActivityEpochMs,
			connectedClients: this._clients.size,
		};
	}
}
