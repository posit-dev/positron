/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronIdleTrackingService = createDecorator<IPositronIdleTrackingService>('positronIdleTrackingService');

export interface IPositronIdleInfo {
	/** Seconds since the last user interaction across all connected clients. */
	secondsIdle: number;
	/** Epoch milliseconds of the last user interaction. */
	lastActivityEpochMs: number;
	/** Number of clients that have reported activity (may include disconnected clients not yet cleaned up). */
	connectedClients: number;
}

/**
 * Server-side service that tracks user activity reported by browser clients.
 *
 * Browser clients report activity timestamps over IPC. The server aggregates
 * these and exposes idle information via the /idle HTTP endpoint for use by
 * hosting platforms like Posit Cloud.
 */
export interface IPositronIdleTrackingService {
	readonly _serviceBrand: undefined;

	/**
	 * Report that a client is active.
	 * @param clientId Unique identifier for the client (e.g., reconnection token).
	 * @param timestampMs Epoch milliseconds when activity was detected.
	 */
	reportActivity(clientId: string, timestampMs: number): void;

	/**
	 * Remove a client from tracking (e.g., on disconnect).
	 */
	removeClient(clientId: string): void;

	/**
	 * Get the current idle information.
	 */
	getIdleInfo(): IPositronIdleInfo;
}
