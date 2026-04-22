/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronIdleInfo, IPositronIdleTrackingService } from '../common/positronIdleTracking.js';

/**
 * Server-side implementation that tracks the most recent user activity
 * reported by any browser client. Timestamps advance monotonically: an
 * older timestamp never overrides a newer one.
 */
export class PositronIdleTrackingService implements IPositronIdleTrackingService {
	declare readonly _serviceBrand: undefined;

	/** Epoch milliseconds of the most recent reported activity. Initialized to server start time. */
	private _lastActivityEpochMs: number = Date.now();

	reportActivity(timestampMs: number): void {
		if (timestampMs > this._lastActivityEpochMs) {
			this._lastActivityEpochMs = timestampMs;
		}
	}

	getIdleInfo(): IPositronIdleInfo {
		return {
			secondsIdle: Math.max(0, Math.floor((Date.now() - this._lastActivityEpochMs) / 1000)),
			lastActivityEpochMs: this._lastActivityEpochMs,
		};
	}
}
