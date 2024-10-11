/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronConnectionEntry, PositronConnectionsCache } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { ConnectionMetadata, IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { MockedConnectionInstance } from 'vs/workbench/services/positronConnections/browser/mockConnections';
import { DisconnectedPositronConnectionsInstance, PositronConnectionsInstance } from 'vs/workbench/services/positronConnections/browser/positronConnectionsInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Event, Emitter } from 'vs/base/common/event';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';

class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	private readonly _cache: PositronConnectionsCache;
	readonly _serviceBrand: undefined;

	private onDidChangeEntriesEmitter = new Emitter<IPositronConnectionEntry[]>;
	onDidChangeEntries: Event<IPositronConnectionEntry[]> = this.onDidChangeEntriesEmitter.event;

	private onDidChangeDataEmitter = new Emitter<void>;
	private onDidChangeData = this.onDidChangeDataEmitter.event;

	private readonly connections: IPositronConnectionInstance[] = [];

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		// Whenever a session starts, we'll register an observer that will create a ConnectionsInstance
		// whenever a new connections client is created by the backend.
		this._register(this._runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		this._cache = new PositronConnectionsCache(this);
		this.onDidChangeData(() => {
			this.refreshConnectionEntries();
		});

		const storedConnections: ConnectionMetadata[] = JSON.parse(
			this._storageService.get('positron-connections', StorageScope.WORKSPACE, '[]')
		);
		storedConnections.forEach((metadata) => {
			if (metadata === null) {
				return;
			}

			const instance = new DisconnectedPositronConnectionsInstance(
				metadata,
				this.onDidChangeDataEmitter,
				this._runtimeSessionService
			);

			this.addConnection(instance);
		});

		this.addConnection(
			new MockedConnectionInstance('hello_world', this.onDidChangeDataEmitter, this)
		);
		this.addConnection(
			new MockedConnectionInstance('Hello world', this.onDidChangeDataEmitter, this)
		);
	}

	getConnectionEntries() {
		const entries = this._cache.entries;
		return entries;
	}

	async refreshConnectionEntries() {
		console.log('regenerating entries', this.connections);
		await this._cache.refreshConnectionEntries();
		this.onDidChangeEntriesEmitter.fire(this._cache.entries);
	}

	getConnections() {
		return this.connections;
	}

	initialize(): void { }

	attachRuntime(session: ILanguageRuntimeSession) {
		this._register(session.onDidCreateClientInstance(async ({ message, client }) => {
			if (client.getClientType() !== RuntimeClientType.Connection) {
				return;
			}

			if (this.hasConnection(client.getClientId())) {
				// A connection with this id is already registered.
				return;
			}

			const instance = await PositronConnectionsInstance.init(
				message.data as ConnectionMetadata,
				this.onDidChangeDataEmitter,
				new ConnectionsClientInstance(client),
				this._runtimeSessionService
			);

			this.addConnection(instance);
		}));

		session.listClients().then((clients) => {
			clients.forEach(async (client) => {
				if (client.getClientType() !== RuntimeClientType.Connection) {
					return;
				}

				const connectionsClient = new ConnectionsClientInstance(client);
				const metadata = await connectionsClient.getMetadata();

				const instance = await PositronConnectionsInstance.init(
					metadata,
					this.onDidChangeDataEmitter,
					connectionsClient,
					this._runtimeSessionService
				);

				this.addConnection(instance);
			});
		});
	}

	addConnection(instance: IPositronConnectionInstance) {
		// If a connection with the same id exists, we will replace it with a new one
		// otherwise just push it to the end of the list.
		const newId = instance.id;
		const existingConnectionIndex = this.connections.findIndex((conn) => {
			return conn.id === newId;
		});

		if (existingConnectionIndex >= 0) {
			this.connections[existingConnectionIndex] = instance;
		} else {
			this.connections.push(instance);
		}

		// Whenever a new connection is added we also update the storage
		this.saveConnectionsState();

		this.refreshConnectionEntries();
	}

	getConnection(id: string) {
		return this.connections.find((conn) => {
			return conn.id === id;
		});
	}

	closeConnection(id: string) {
		const connection = this.getConnection(id);
		if (connection && connection.disconnect) {
			connection.disconnect();
		}
		// We don't remove the connection from the `_connections` list as
		// we expect that `connection.disconnect()` will make it inactive.
	}

	clearAllConnections() {
		const ids = this.connections.map((x) => x.id);
		ids.forEach((id) => {
			this.removeConnection(id);
		});
	}

	hasConnection(clientId: string) {
		return this.getConnection(clientId) !== undefined;
	}

	private saveConnectionsState() {
		this._storageService.store(
			'positron-connections',
			this.connections.map((con) => {
				return con.metadata;
			}),
			StorageScope.WORKSPACE,
			StorageTarget.USER
		);
	}

	private removeConnection(id: string) {
		console.log('Removing connection', id);
		const index = this.connections.findIndex((con) => {
			return con.id === id;
		});

		if (index < 0) {
			return;
		}

		const [connection] = this.connections.splice(index, 1);
		this.saveConnectionsState();

		console.log('connections', this.connections);

		console.log('connection', connection);
		if (connection.disconnect) {
			// if a disconnect method is implemented, we expect it to run onDidChangeDataEmitter
			// otherwise, we run it ourselves.
			connection.disconnect();
		} else {
			this.onDidChangeDataEmitter.fire();
		}
	}
}

registerSingleton(
	IPositronConnectionsService,
	PositronConnectionsService,
	InstantiationType.Delayed
);
