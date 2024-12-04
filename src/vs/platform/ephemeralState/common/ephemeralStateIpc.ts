/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IEphemeralStateService } from './ephemeralState.js';

export const EPHEMERAL_STATE_CHANNEL_NAME = 'ephemeralState';

/**
 * The server side of the channel for the EphemeralStateService.
 */
export class EphemeralStateChannel implements IServerChannel {
	constructor(private readonly service: IEphemeralStateService) {
	}

	async call<T>(_ctx: any, command: string, args?: any, cancellationToken?: CancellationToken): Promise<T> {
		switch (command) {
			case 'get': {
				return await this.service.getItem(args.key, args.defaultValue);
			}
			case 'set': {
				await this.service.setItem(args.key, args.value);
				return args.key;
			}
			case 'remove': {
				await this.service.removeItem(args);
				return args;
			}
		}
		throw new Error(`Command not found: ${command}`);
	}

	/**
	 * Event listener; currently not implemented since this service doesn't
	 * expose any events.
	 */
	listen<T>(_ctx: any, event: string, arg?: any): Event<T> {
		throw new Error('Method not implemented.');
	}
}

/**
 * The client side of the channel for the EphemeralStateService.
 */
export class EphemeralStateChannelClient implements IEphemeralStateService {
	/**
	 * Create a new instance of the EphemeralStateChannelClient.
	 *
	 * @param _channel The channel to use for communication.
	 */
	constructor(private readonly _channel: IChannel) { }
	_serviceBrand: undefined;

	async getItem<T>(key: unknown, defaultValue?: unknown): Promise<T | T | undefined> {
		return this._channel.call('get', { key, defaultValue });
	}

	async setItem(key: string, data?: object | string | number | boolean | undefined | null): Promise<void> {
		return this._channel.call('set', { key, value: data });
	}

	async removeItem(key: string): Promise<void> {
		return this._channel.call('remove', key);
	}
}
