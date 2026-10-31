/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { ConnectionMetadata, IConnectionMetadata, IPositronConnectionInstance } from '../common/interfaces/positronConnectionsInstance.js';
import { IPositronConnectionsService, ISessionConnectionCodeChangeEvent, POSITRON_CONNECTIONS_VIEW_ID } from '../common/interfaces/positronConnectionsService.js';
import { DisconnectedPositronConnectionsInstance, PositronConnectionsInstance } from './positronConnectionsInstance.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IViewsService } from '../../views/common/viewsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { PositronConnectionsDriverManager } from './positronConnectionsDrivers.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from '../../positronDataConnections/common/positronDataConnectionsConfiguration.js';
import { raceTimeout } from '../../../../base/common/async.js';

/** How long a connection comm already open at startup has to say what it is before it is closed. */
const STARTUP_METADATA_TIMEOUT_MS = 5000;

export class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	readonly _serviceBrand: undefined;

	private onDidChangeConnectionsEmitter = this._register(new Emitter<IPositronConnectionInstance[]>);
	onDidChangeConnections: Event<IPositronConnectionInstance[]> = this.onDidChangeConnectionsEmitter.event;

	public onDidFocusEmitter = this._register(new Emitter<string>);
	public onDidFocus = this.onDidFocusEmitter.event;

	private readonly onDidChangeSessionConnectionCodeEmitter = this._register(new Emitter<ISessionConnectionCodeChangeEvent>);
	readonly onDidChangeSessionConnectionCode = this.onDidChangeSessionConnectionCodeEmitter.event;

	private readonly connections: IPositronConnectionInstance[] = [];

	// The code behind the connection comm each session opened most recently, keyed by session id.
	// See getSessionConnectionCode.
	private readonly sessionConnectionCode = new Map<string, string>();
	private readonly closeConnectionsListeners = this._register(new DisposableMap<string, DisposableStore>());
	public readonly driverManager: PositronConnectionsDriverManager;

	constructor(
		@IRuntimeSessionService public readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IViewsService private readonly viewsService: IViewsService,
		@ILogService public readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		this.driverManager = this._register(new PositronConnectionsDriverManager(this));

		// With the Data Connections feature on, the Connections pane is not registered, so there is
		// nowhere to show runtime connections. The setting requires a reload, so it is read once.
		if (configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === true) {
			this._register(this.runtimeSessionService.onDidStartRuntime((session) => {
				this.closeRuntimeConnections(session);
			}));
			this._register(this.runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
				this.closeConnectionsListeners.deleteAndDispose(sessionId);
			}));
			return;
		}

		// Whenever a session starts, we'll register an observer that will create a ConnectionsInstance
		// whenever a new connections client is created by the backend.
		this._register(this.runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		this.addStoredConnections().catch((e) => {
			this.logService.error('Error while adding stored connections', e);
			this.notificationService.error('Error while loading stored connections');
		});

		this._register(this.onDidFocus(async (id) => {
			await this.viewsService.openView(POSITRON_CONNECTIONS_VIEW_ID, false);
		}));
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
			if (metadata === null || metadata === undefined) {
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

	/**
	 * Closes the connection comms a session opens, which would otherwise stay open until the session
	 * ends. R opens one for every odbc or DBI connection.
	 *
	 * Each comm's code is recorded first; see getSessionConnectionCode. The listener stays for the
	 * life of the session rather than of its runtime: a restart starts a new kernel in the same
	 * session without firing onDidStartRuntime again, and that kernel opens comms of its own.
	 */
	private async closeRuntimeConnections(session: ILanguageRuntimeSession) {
		// Whether a comm has opened, or the session has ended, since the comms already open were
		// listed. Either is newer than anything those comms report, which then must not replace it.
		let superseded = false;
		const store = new DisposableStore();
		store.add(session.onDidCreateClientInstance(({ message, client }) => {
			if (client.getClientType() === RuntimeClientType.Connection) {
				superseded = true;
				this.setSessionConnectionCode(session.sessionId, (message.data as Partial<IConnectionMetadata> | undefined)?.code);
				client.dispose();
			}
		}));
		store.add(session.onDidEndSession(() => {
			superseded = true;
			// Whatever the runtime was connected to went with it.
			this.setSessionConnectionCode(session.sessionId, undefined);
		}));
		this.closeConnectionsListeners.set(session.sessionId, store);

		try {
			const clients = await session.listClients(RuntimeClientType.Connection);
			// With several open, nothing says which the session opened last, so none of them says
			// where it is. Left unknown rather than guessed: a wrong code would have a SQL file's
			// statement run in a session on another database.
			const sole = clients.length === 1;
			await Promise.all(clients.map(async client => {
				const connection = new ConnectionsClientInstance(client);
				try {
					// Bounded, so a comm that never answers is still closed.
					const metadata = await raceTimeout(connection.getMetadata(), STARTUP_METADATA_TIMEOUT_MS);
					if (metadata && sole && !superseded) {
						this.setSessionConnectionCode(session.sessionId, metadata.code);
					}
				} finally {
					connection.dispose();
					client.dispose();
				}
			}));
		} catch (e) {
			this.logService.error('Error while closing runtime connections', e);
		}
	}

	/**
	 * The code behind the connection comm a session opened most recently, or undefined if it has
	 * opened none since Positron started watching it.
	 *
	 * A ggsql session holds one database at a time and opens a comm whenever that changes, with
	 * `-- @connect: <uri>` as its code, so for ggsql this says which database the session is on.
	 * Positron closes these comms on arrival, so the code is read on the way past: a session
	 * reconnected after a reload has had its comm closed already, and reads as undefined until it
	 * connects again.
	 */
	getSessionConnectionCode(sessionId: string): string | undefined {
		return this.sessionConnectionCode.get(sessionId);
	}

	private setSessionConnectionCode(sessionId: string, code: string | undefined) {
		if (this.sessionConnectionCode.get(sessionId) === code) {
			return;
		}
		if (code === undefined) {
			this.sessionConnectionCode.delete(sessionId);
		} else {
			this.sessionConnectionCode.set(sessionId, code);
		}
		this.onDidChangeSessionConnectionCodeEmitter.fire({ sessionId, code });
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
				new ConnectionMetadata(message.data as unknown as IConnectionMetadata),
				new ConnectionsClientInstance(client),
				this
			);

			this._register(instance);
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

				this._register(instance);
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
