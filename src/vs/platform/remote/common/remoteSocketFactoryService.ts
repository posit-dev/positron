/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
// --- Start PWB: Let callers cancel a pending connect (rstudio-pro#13201) ---
import { CancellationToken } from '../../../base/common/cancellation.js';
// --- End PWB ---
import { ISocket } from '../../../base/parts/ipc/common/ipc.net.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { RemoteConnectionOfType, RemoteConnectionType, RemoteConnection } from './remoteAuthorityResolver.js';

export const IRemoteSocketFactoryService = createDecorator<IRemoteSocketFactoryService>('remoteSocketFactoryService');

export interface IRemoteSocketFactoryService {
	readonly _serviceBrand: undefined;

	/**
	 * Register a socket factory for the given message passing type
	 * @param type passing type to register for
	 * @param factory function that returns the socket factory, or undefined if
	 * it can't handle the data.
	 */
	register<T extends RemoteConnectionType>(type: T, factory: ISocketFactory<T>): IDisposable;

	// --- Start PWB: Let callers cancel a pending connect ---
	connect(connectTo: RemoteConnection, path: string, query: string, debugLabel: string, cancellationToken?: CancellationToken): Promise<ISocket>;
	// --- End PWB ---
}

export interface ISocketFactory<T extends RemoteConnectionType> {
	supports(connectTo: RemoteConnectionOfType<T>): boolean;
	// --- Start PWB: Let callers cancel a pending connect ---
	connect(connectTo: RemoteConnectionOfType<T>, path: string, query: string, debugLabel: string, cancellationToken?: CancellationToken): Promise<ISocket>;
	// --- End PWB ---
}

export class RemoteSocketFactoryService implements IRemoteSocketFactoryService {
	declare readonly _serviceBrand: undefined;

	private readonly factories: { [T in RemoteConnectionType]?: ISocketFactory<T>[] } = {};

	public register<T extends RemoteConnectionType>(type: T, factory: ISocketFactory<T>): IDisposable {
		this.factories[type] ??= [];
		this.factories[type]!.push(factory);
		return toDisposable(() => {
			const idx = this.factories[type]?.indexOf(factory);
			if (typeof idx === 'number' && idx >= 0) {
				this.factories[type]?.splice(idx, 1);
			}
		});
	}

	private getSocketFactory<T extends RemoteConnectionType>(messagePassing: RemoteConnectionOfType<T>): ISocketFactory<T> | undefined {
		const factories = (this.factories[messagePassing.type] || []);
		return factories.find(factory => factory.supports(messagePassing));
	}

	// --- Start PWB: Let callers cancel a pending connect ---
	public connect(connectTo: RemoteConnection, path: string, query: string, debugLabel: string, cancellationToken?: CancellationToken): Promise<ISocket> {
		// --- End PWB ---
		const socketFactory = this.getSocketFactory(connectTo);
		if (!socketFactory) {
			throw new Error(`No socket factory found for ${connectTo}`);
		}
		// --- Start PWB: Let callers cancel a pending connect ---
		return socketFactory.connect(connectTo, path, query, debugLabel, cancellationToken);
		// --- End PWB ---
	}
}
