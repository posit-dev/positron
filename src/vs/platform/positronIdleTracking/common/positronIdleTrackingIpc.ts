/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IPositronIdleTrackingService } from './positronIdleTracking.js';

export const POSITRON_IDLE_TRACKING_CHANNEL_NAME = 'positronIdleTracking';

/**
 * Server-side IPC channel that forwards calls to the idle tracking service.
 */
export class PositronIdleTrackingChannel implements IServerChannel {
	constructor(private readonly service: IPositronIdleTrackingService) {
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async call<T>(_ctx: any, command: string, _args?: any): Promise<T> {
		switch (command) {
			case 'reportActivity': {
				// Use server-side Date.now() so the tracked timestamp is immune to
				// browser clock skew (ahead or behind). The client timestamp is not
				// needed: the server just needs to know "activity arrived now".
				this.service.reportActivity(Date.now());
				return undefined as unknown as T;
			}
		}
		throw new Error(`Command not found: ${command}`);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	listen<T>(_ctx: any, _event: string, _arg?: any): Event<T> {
		throw new Error('Method not implemented.');
	}
}

/**
 * Client-side IPC channel wrapper used by the browser to report activity
 * to the server.
 */
export class PositronIdleTrackingChannelClient {
	constructor(private readonly _channel: IChannel) { }

	reportActivity(timestampMs: number): Promise<void> {
		return this._channel.call('reportActivity', { timestampMs });
	}
}
