/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronIdleTrackingService = createDecorator<IPositronIdleTrackingService>('positronIdleTrackingService');

export interface IPositronIdleInfo {
	/** Seconds since the last reported user activity. */
	secondsIdle: number;
	/** Epoch milliseconds of the last reported user activity. */
	lastActivityEpochMs: number;
}

/**
 * Server-side service that tracks user activity reported by browser clients.
 *
 * Browser clients report activity timestamps over IPC. The server keeps the
 * most recent timestamp seen (monotonic) and exposes idle information via
 * the /idle HTTP endpoint for use by hosting platforms like Posit Cloud.
 */
export interface IPositronIdleTrackingService {
	readonly _serviceBrand: undefined;

	/**
	 * Report that a user is active.
	 * @param timestampMs Epoch milliseconds when activity was detected.
	 *                    Timestamps older than the current tracked value are ignored.
	 */
	reportActivity(timestampMs: number): void;

	/**
	 * Get the current idle information.
	 */
	getIdleInfo(): IPositronIdleInfo;
}
