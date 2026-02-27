/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo, POSITRON_MEMORY_INFO_CHANNEL_NAME } from './positronMemoryUsage.js';

export { POSITRON_MEMORY_INFO_CHANNEL_NAME };

/**
 * Server-side IPC channel for the memory info provider.
 */
export class PositronMemoryInfoChannel implements IServerChannel {
	constructor(private readonly service: IPositronMemoryInfoProvider) { }

	async call<T>(_ctx: unknown, command: string, _args?: unknown, _cancellationToken?: CancellationToken): Promise<T> {
		switch (command) {
			case 'getMemoryInfo': {
				return await this.service.getMemoryInfo() as T;
			}
		}
		throw new Error(`Command not found: ${command}`);
	}

	listen<T>(_ctx: unknown, _event: string, _arg?: unknown): Event<T> {
		throw new Error('Method not implemented.');
	}
}

/**
 * Client-side IPC channel for the memory info provider.
 */
export class PositronMemoryInfoChannelClient implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	constructor(private readonly _channel: IChannel) { }

	getMemoryInfo(): Promise<IPositronProcessMemoryInfo> {
		return this._channel.call('getMemoryInfo');
	}
}
