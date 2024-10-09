/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronConnectionEntry, PositronConnectionsCache } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { MockedConnectionInstance } from 'vs/workbench/services/positronConnections/browser/mockConnections';
import { PositronConnectionsInstance } from 'vs/workbench/services/positronConnections/browser/positronConnectionsInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Event, Emitter } from 'vs/base/common/event';
class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	private readonly _cache: PositronConnectionsCache;
	readonly _serviceBrand: undefined;

	private onDidChangeEntriesEmitter = new Emitter<IPositronConnectionEntry[]>;
	onDidChangeEntries: Event<IPositronConnectionEntry[]> = this.onDidChangeEntriesEmitter.event;

	private onDidChangeDataEmitter = new Emitter<void>;
	private onDidChangeData = this.onDidChangeDataEmitter.event;

	private readonly connections: IPositronConnectionInstance[] = [
		new MockedConnectionInstance('hello_world', this.onDidChangeDataEmitter),
		new MockedConnectionInstance('Hello world', this.onDidChangeDataEmitter)
	];

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
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
	}

	getConnectionEntries() {
		const entries = this._cache.entries;
		return entries;
	}

	async refreshConnectionEntries() {
		await this._cache.refreshConnectionEntries();
		this.onDidChangeEntriesEmitter.fire(this._cache.entries);
	}

	getConnections() {
		return this.connections;
	}

	initialize(): void { }

	attachRuntime(session: ILanguageRuntimeSession) {
		this._register(session.onDidCreateClientInstance(({ message, client }) => {
			if (client.getClientType() !== RuntimeClientType.Connection) {
				return;
			}

			if (this.hasConnection(client.getClientId())) {
				// A connection with this id is already registered.
				return;
			}

			this.addConnection(new PositronConnectionsInstance(
				this.onDidChangeDataEmitter,
				new ConnectionsClientInstance(client),
				message.data as any
			));
		}));

		session.listClients().then((clients) => {
			clients.forEach(async (client) => {
				if (client.getClientType() !== RuntimeClientType.Connection) {
					return;
				}

				const connectionsClient = new ConnectionsClientInstance(client);
				const metadata = await connectionsClient.getMetadata();

				this.addConnection(new PositronConnectionsInstance(
					this.onDidChangeDataEmitter,
					connectionsClient,
					metadata
				));
			});
		});
	}

	addConnection(instance: PositronConnectionsInstance) {
		this.connections.push(instance);
		// When a connection is added, we should refresh the connection entries
		this.refreshConnectionEntries();
	}

	getConnection(clientId: string) {
		return this.connections.find((conn) => {
			return conn.getClientId() === clientId;
		});
	}

	hasConnection(clientId: string) {
		return this.getConnection(clientId) !== undefined;
	}
}

registerSingleton(
	IPositronConnectionsService,
	PositronConnectionsService,
	InstantiationType.Delayed
);
