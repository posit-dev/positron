/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { ConnectionMetadata, IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService, POSITRON_CONNECTIONS_VIEW_ID } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { DisconnectedPositronConnectionsInstance, PositronConnectionsInstance } from 'vs/workbench/services/positronConnections/browser/positronConnectionsInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Event, Emitter } from 'vs/base/common/event';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { POSITRON_CONNECTIONS_VIEW_ENABLED, USE_POSITRON_CONNECTIONS_KEY } from 'vs/workbench/services/positronConnections/browser/positronConnectionsFeatureFlag';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationChangeEvent, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';

class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	readonly _serviceBrand: undefined;

	private onDidChangeConnectionsEmitter = this._register(new Emitter<IPositronConnectionInstance[]>);
	onDidChangeConnections: Event<IPositronConnectionInstance[]> = this.onDidChangeConnectionsEmitter.event;

	public onDidFocusEmitter = this._register(new Emitter<string>);
	public onDidFocus = this.onDidFocusEmitter.event;

	private readonly connections: IPositronConnectionInstance[] = [];
	private readonly viewEnabled: IContextKey<boolean>;

	constructor(
		@IRuntimeSessionService public readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IViewsService private readonly viewsService: IViewsService,
		@ILogService public readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.viewEnabled = POSITRON_CONNECTIONS_VIEW_ENABLED.bindTo(this.contextKeyService);
		const enabled = this.configurationService.getValue<boolean>(USE_POSITRON_CONNECTIONS_KEY);
		this.viewEnabled.set(enabled);

		// Whenever a session starts, we'll register an observer that will create a ConnectionsInstance
		// whenever a new connections client is created by the backend.
		this._register(this.runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		const storedConnections: ConnectionMetadata[] = JSON.parse(
			this.storageService.get('positron-connections', StorageScope.WORKSPACE, '[]')
		);
		storedConnections.forEach((metadata) => {
			if (metadata === null) {
				return;
			}

			const instance = new DisconnectedPositronConnectionsInstance(
				metadata,
				this.runtimeSessionService,
				this
			);

			this.addConnection(instance);
		});

		this._register(this.configurationService.onDidChangeConfiguration((e) => {
			this.handleConfigChange(e);
		}));

		this._register(this.onDidFocus(async (id) => {
			await this.viewsService.openView(POSITRON_CONNECTIONS_VIEW_ID, false);
		}));
	}

	private handleConfigChange(e: IConfigurationChangeEvent) {
		if (e.affectsConfiguration(USE_POSITRON_CONNECTIONS_KEY)) {
			const enabled = this.configurationService.getValue<boolean>(USE_POSITRON_CONNECTIONS_KEY);
			this.viewEnabled.set(enabled);
		}
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
				new ConnectionsClientInstance(client),
				this
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
					connectionsClient,
					this
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

		this._register(instance.onDidChangeStatus(() => {
			// We refresh the connections list whenever a connection changes its status
			// Because we display that information in the connections view.
			this.onDidChangeConnectionsEmitter.fire(this.connections);
		}));

		// Whenever a new connection is added we also update the storage
		this.saveConnectionsState();
		this.onDidChangeConnectionsEmitter.fire(this.connections);
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
		this.onDidChangeConnectionsEmitter.fire(this.connections);
		// We don't remove the connection from the `_connections` list as
		// we expect that `connection.disconnect()` will make it inactive.
	}

	clearAllConnections() {
		const ids = this.connections.map((x) => x.id);
		ids.forEach((id) => {
			this.removeConnection(id);
		});
		this.onDidChangeConnectionsEmitter.fire(this.connections);
	}

	hasConnection(clientId: string) {
		return this.getConnection(clientId) !== undefined;
	}

	notify(message: string, severity: Severity) {
		return this.notificationService.notify({
			message: message,
			severity: severity,
			source: 'Connections Pane'
		});
	}

	log(message: string) {
		// Currently everything is logged as error
		this.logService.error(message);
	}

	removeConnection(id: string) {
		const index = this.connections.findIndex((con) => {
			return con.id === id;
		});

		if (index < 0) {
			return;
		}

		const [connection] = this.connections.splice(index, 1);
		this.saveConnectionsState();

		if (connection.disconnect) {
			// if a disconnect method is implemented, we expect it to run onDidChangeDataEmitter
			// otherwise, we run it ourselves.
			connection.disconnect();
		}

		this.onDidChangeConnectionsEmitter.fire(this.connections);
	}

	private saveConnectionsState() {
		this.storageService.store(
			'positron-connections',
			this.connections.map((con) => {
				return con.metadata;
			}),
			StorageScope.WORKSPACE,
			StorageTarget.USER
		);
	}
}

registerSingleton(
	IPositronConnectionsService,
	PositronConnectionsService,
	InstantiationType.Delayed
);
