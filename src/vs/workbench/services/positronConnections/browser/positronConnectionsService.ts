/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { ConnectionMetadata, IConnectionMetadata, IPositronConnectionInstance } from '../common/interfaces/positronConnectionsInstance.js';
import { IPositronConnectionsService, POSITRON_CONNECTIONS_VIEW_ID } from '../common/interfaces/positronConnectionsService.js';
import { DisconnectedPositronConnectionsInstance, PositronConnectionsInstance } from './positronConnectionsInstance.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { POSITRON_CONNECTIONS_VIEW_ENABLED, USE_POSITRON_CONNECTIONS_KEY } from './positronConnectionsFeatureFlag.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewsService } from '../../views/common/viewsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { PositronConnectionsDriverManager } from './positronConnectionsDrivers.js';

class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	readonly _serviceBrand: undefined;

	private onDidChangeConnectionsEmitter = this._register(new Emitter<IPositronConnectionInstance[]>);
	onDidChangeConnections: Event<IPositronConnectionInstance[]> = this.onDidChangeConnectionsEmitter.event;

	public onDidFocusEmitter = this._register(new Emitter<string>);
	public onDidFocus = this.onDidFocusEmitter.event;

	private readonly connections: IPositronConnectionInstance[] = [];
	public readonly driverManager: PositronConnectionsDriverManager;
	private readonly viewEnabled: IContextKey<boolean>;

	constructor(
		@IRuntimeSessionService public readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IViewsService private readonly viewsService: IViewsService,
		@ILogService public readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();

		this.driverManager = new PositronConnectionsDriverManager(this);

		this.viewEnabled = POSITRON_CONNECTIONS_VIEW_ENABLED.bindTo(this.contextKeyService);
		const enabled = this.configurationService.getValue<boolean>(USE_POSITRON_CONNECTIONS_KEY);
		this.viewEnabled.set(enabled);

		// Whenever a session starts, we'll register an observer that will create a ConnectionsInstance
		// whenever a new connections client is created by the backend.
		this._register(this.runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		this.addStoredConnections().catch((e) => {
			this.logService.error('Error while adding stored connections', e);
			this.notificationService.error('Error while loading stored connections');
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

	private getPrivateStorageId(createIfNone = false): string | undefined {
		let id = this.storageService.get('positron-connections-secret-id', StorageScope.WORKSPACE);

		if (createIfNone && !id) {
			// If an id did not exist, we generate a new one and store it.
			// This will trigger Positron to request access to secret keys.
			id = generateUuid();
			this.storageService.store(
				'positron-connections-secret-id',
				id,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		}

		return id;
	}

	private async deletePrivateStorageId() {
		const id = this.getPrivateStorageId();

		this.storageService.store('positron-connections-secret-id',
			undefined,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE
		);

		if (id) {
			await this.secretStorageService.delete(id);
		}
	}

	// Adds stored connections to the service, so users can re-connect later.
	private async addStoredConnections() {
		const id = this.getPrivateStorageId();

		let storedConnections: IConnectionMetadata[] = [];
		if (id) {
			storedConnections = JSON.parse(
				await this.secretStorageService.get(id) || '[]'
			);
		}

		storedConnections.forEach((metadata) => {
			if (metadata === null) {
				return;
			}

			const instance = new DisconnectedPositronConnectionsInstance(
				new ConnectionMetadata(metadata),
				this.runtimeSessionService,
				this
			);

			this.addConnection(instance);
		});
	}

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
				new ConnectionMetadata(message.data as IConnectionMetadata),
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
					new ConnectionMetadata(metadata),
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
		// This is called whenever a connection is added or removed, thus
		// we save the entire state of the connections list -> will require access
		// to the secret storage service unless the list of connections is empty.
		// In this case we can simply delete the private storage key we have stored earlier.
		const id = this.getPrivateStorageId(true);
		if (id) { // should always be true
			if (this.connections.length === 0) {
				this.deletePrivateStorageId();
			} else {
				this.secretStorageService.set(
					id,
					JSON.stringify(this.connections.map((con) => {
						return con.metadata;
					}))
				);
			}
		}
	}
}

registerSingleton(
	IPositronConnectionsService,
	PositronConnectionsService,
	InstantiationType.Delayed
);
