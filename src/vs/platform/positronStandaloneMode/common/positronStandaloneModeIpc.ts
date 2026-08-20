/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IPositronStandaloneModeState } from './positronStandaloneMode.js';

/**
 * Server-side IPC channel over which a window reports standalone mode
 * engagement to the main process.
 */
export class PositronStandaloneModeChannel implements IServerChannel {

	constructor(private readonly service: IPositronStandaloneModeState) { }

	async call<T>(_ctx: unknown, command: string, args?: unknown, _cancellationToken?: CancellationToken): Promise<T> {
		switch (command) {
			case 'acquire': {
				const [windowId, exitCommandId] = args as [number, string];
				return await this.service.acquire(windowId, exitCommandId) as T;
			}
			case 'release': {
				const [windowId] = args as [number];
				return await this.service.release(windowId) as T;
			}
		}
		throw new Error(`Command not found: ${command}`);
	}

	listen<T>(_ctx: unknown, _event: string, _arg?: unknown): Event<T> {
		throw new Error('Method not implemented.');
	}
}

/**
 * Client-side channel a window uses to claim and release standalone mode.
 */
export class PositronStandaloneModeChannelClient implements IPositronStandaloneModeState {

	constructor(private readonly channel: IChannel) { }

	acquire(windowId: number, exitCommandId: string): Promise<boolean> {
		return this.channel.call('acquire', [windowId, exitCommandId]);
	}

	release(windowId: number): Promise<void> {
		return this.channel.call('release', [windowId]);
	}
}
