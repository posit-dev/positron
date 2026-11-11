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
import { IRuntimeClientInstance, RuntimeClientState } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { IPositronDataConnectionsService, POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../../positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { discoveredProfileId } from '../../positronDataConnections/browser/positronDataConnectionsService.js';
import { IDataConnectionProfile } from '../../positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { isRuntimeConnectionLanguage, isRuntimeDataConnectionDriverId, RUNTIME_DATA_CONNECTION_LANGUAGES, RuntimeConnectionLanguage } from '../common/runtimeDataConnections.js';
import { RuntimeDataConnectionDriver } from './runtimeDataConnectionDriver.js';
import { localize } from '../../../../nls.js';

/** How long a connection comm already open at startup has to say what it is before it is decided on. */
const STARTUP_METADATA_TIMEOUT_MS = 5000;

/**
 * The languages whose connection comms are known to be safe to close. Positron has closed ggsql
 * comms on arrival since Data Connections shipped, and ggsql reads the session's database from the
 * code recorded on the way past (see getSessionConnectionCode).
 */
const CLOSABLE_CONNECTION_LANGUAGES: ReadonlySet<string> = new Set(['ggsql']);

/**
 * Whether a connection comm is kept open rather than closed; see watchRuntimeConnections. A comm
 * that does not say what language it is (no metadata, or metadata with no `language_id`) takes its
 * session's language.
 */
function keepsConnectionComm(session: ILanguageRuntimeSession, metadata: Partial<IConnectionMetadata> | undefined): boolean {
	return !CLOSABLE_CONNECTION_LANGUAGES.has(metadata?.language_id ?? session.runtimeMetadata.languageId);
}

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
	private readonly watchConnectionsListeners = this._register(new DisposableMap<string, DisposableStore>());
	public readonly driverManager: PositronConnectionsDriverManager;

	// The drivers that show kept R and Python comms as Data Connections rows, by language. Empty
	// unless Data Connections is enabled.
	private readonly runtimeDrivers = new Map<RuntimeConnectionLanguage, RuntimeDataConnectionDriver>();

	// Runtime rows the runtime asked to focus before they were connected, by profile id. Each is
	// revealed once the bridge connects it, or dropped when its discovery goes away.
	private readonly pendingFocus = new Set<string>();

	// The close listener of each kept comm's wrapper, which releases the wrapper. Disposing these
	// removes only the listeners, never a comm.
	private readonly keptConnectionListeners = this._register(new DisposableMap<ConnectionsClientInstance>());

	constructor(
		@IRuntimeSessionService public readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IViewsService private readonly viewsService: IViewsService,
		@ILogService public readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IPositronDataConnectionsService private readonly dataConnectionsService: IPositronDataConnectionsService,
	) {
		super();

		this.driverManager = this._register(new PositronConnectionsDriverManager(this));

		// With the Data Connections feature on, the Connections pane is not registered, so runtime
		// connections are shown in Data Connections instead: R and Python comms through the runtime
		// drivers, other kept comms not at all. The setting requires a reload, so it is read once.
		if (configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === true) {
			for (const languageId of RUNTIME_DATA_CONNECTION_LANGUAGES) {
				this.runtimeDrivers.set(languageId, this.createRuntimeDriver(languageId));
			}
			this._register(this.dataConnectionsService.onDidChangeDiscoveredProfiles(profiles => {
				this.connectRuntimeProfiles(profiles);
			}));
			this._register(this.runtimeSessionService.onDidStartRuntime((session) => {
				this.watchRuntimeConnections(session);
			}));
			this._register(this.runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
				this.watchConnectionsListeners.deleteAndDispose(sessionId);
				this.removeRuntimeSession(sessionId);
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

	/**
	 * Creates the runtime driver for a language and registers it with Data Connections. Each comm
	 * the driver adds or removes re-registers it, which refreshes discovery.
	 * @param languageId The runtime language.
	 */
	private createRuntimeDriver(languageId: RuntimeConnectionLanguage): RuntimeDataConnectionDriver {
		const driver: RuntimeDataConnectionDriver = this._register(new RuntimeDataConnectionDriver(
			languageId,
			() => this.dataConnectionsService.driverManager.registerDriver(driver),
		));
		this._register(driver.onDidFocus(connectionId => {
			this.focusRuntimeConnection(discoveredProfileId(driver.id, connectionId));
		}));
		this._register(driver.onDidUpdate(connectionId => {
			this.dataConnectionsService.requestRefresh(discoveredProfileId(driver.id, connectionId));
		}));
		this.dataConnectionsService.driverManager.registerDriver(driver);
		return driver;
	}

	/**
	 * Connects each discovered runtime row that has no connection yet. The object behind a runtime
	 * row is already live in its session, so the row is shown connected (Decision 3). A row the user
	 * disconnects is not reconnected: disconnecting closes its comm, which removes the discovery.
	 * @param profiles The discovered profiles.
	 */
	private connectRuntimeProfiles(profiles: readonly IDataConnectionProfile[]) {
		const discovered = new Set<string>();
		for (const profile of profiles) {
			if (!isRuntimeDataConnectionDriverId(profile.driverMetadata.id)) {
				continue;
			}
			discovered.add(profile.id);
			if (this.dataConnectionsService.getInstanceForProfile(profile.id) !== undefined) {
				continue;
			}
			this.dataConnectionsService.connect(profile.id).then(() => {
				if (this.pendingFocus.delete(profile.id)) {
					void this.revealRuntimeConnection(profile.id);
				}
			}, err => {
				// Expected when the comm closes between its discovery and the connect.
				this.logService.warn(`Error while connecting runtime connection ${profile.id}`, err);
			});
		}

		// A focus held for a row whose discovery went away without connecting has nothing to show.
		for (const profileId of [...this.pendingFocus]) {
			if (!discovered.has(profileId)) {
				this.pendingFocus.delete(profileId);
			}
		}
	}

	/**
	 * Shows a runtime row the runtime asked to focus: now if it is connected, otherwise once the
	 * bridge connects it. Ark asks right after the comm opens, before the row exists.
	 * @param profileId The row's discovered profile id.
	 */
	private focusRuntimeConnection(profileId: string) {
		if (this.dataConnectionsService.getInstanceForProfile(profileId) !== undefined) {
			void this.revealRuntimeConnection(profileId);
		} else {
			this.pendingFocus.add(profileId);
		}
	}

	/**
	 * Opens the Data Connections pane and reveals a runtime row in it.
	 * @param profileId The row's discovered profile id.
	 */
	private async revealRuntimeConnection(profileId: string) {
		try {
			await this.viewsService.openView(POSITRON_DATA_CONNECTIONS_VIEW_ID, false);
			this.dataConnectionsService.revealConnection(profileId);
		} catch (e) {
			this.logService.error(`Error while revealing runtime connection ${profileId}`, e);
		}
	}

	/**
	 * Drops a session's comms from the runtime drivers, without closing them.
	 * @param sessionId The session id.
	 */
	private removeRuntimeSession(sessionId: string) {
		for (const driver of this.runtimeDrivers.values()) {
			driver.removeSession(sessionId);
		}
	}

	/**
	 * Whether a runtime driver already holds a comm.
	 * @param sessionId The owning session id.
	 * @param clientId The comm's client id.
	 */
	private runtimeDriverHolds(sessionId: string, clientId: string): boolean {
		for (const driver of this.runtimeDrivers.values()) {
			if (driver.hasConnection(sessionId, clientId)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Hands a kept comm to the runtime driver for its language, if there is one. The language is the
	 * comm's `language_id`, else its session's.
	 * @param session The session that owns the comm.
	 * @param connection The comm's one wrapper. Never disposed here: that would close the comm.
	 * @param metadata What the comm reported about itself, if anything.
	 * @returns Whether a runtime driver now holds the comm.
	 */
	private addRuntimeConnection(
		session: ILanguageRuntimeSession,
		connection: ConnectionsClientInstance,
		metadata: Partial<IConnectionMetadata> | undefined,
	): boolean {
		const languageId = metadata?.language_id ?? session.runtimeMetadata.languageId;
		const driver = isRuntimeConnectionLanguage(languageId) ? this.runtimeDrivers.get(languageId) : undefined;
		if (!driver) {
			return false;
		}
		driver.addConnection({
			sessionId: session.sessionId,
			sessionName: session.dynState.sessionName,
			client: connection,
			metadata: {
				...metadata,
				// A startup comm whose metadata never arrived still gets a row.
				name: metadata?.name ?? localize('positron.connections.unnamedRuntimeConnection', "Connection"),
				language_id: languageId,
			},
		});
		return driver.hasConnection(session.sessionId, connection.getClientId());
	}

	/**
	 * Releases a kept comm's wrapper once the comm has closed, when the runtime closes it or the
	 * session ends. Disposing the wrapper earlier would close the comm. A comm that is already
	 * closed is released now, since its close has already fired.
	 * @param connection The wrapper.
	 */
	private releaseWhenClosed(connection: ConnectionsClientInstance) {
		if (connection.clientState.get() === RuntimeClientState.Closed) {
			connection.dispose();
		} else {
			this.keptConnectionListeners.set(connection, Event.once(connection.onDidClose)(() => {
				this.keptConnectionListeners.deleteAndDispose(connection);
				connection.dispose();
			}));
		}
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
	 * Watches the connection comms a session opens. Each comm's code is recorded; see
	 * getSessionConnectionCode.
	 *
	 * Only comms known to be safe to close (ggsql's; see CLOSABLE_CONNECTION_LANGUAGES) are closed.
	 * Every other comm is kept open until the runtime closes it or the session ends, because closing
	 * one can run the connection's disconnect() in the kernel. R and Python do: Ark through
	 * `.ps.connection_close`, Python through `_close_connection`. The object the user's code just
	 * opened would then be invalid a moment later.
	 *
	 * A kept R or Python comm is wrapped once and handed to that language's runtime driver, which
	 * shows it as a Data Connections row. A comm can arrive on both the new-comm and the startup
	 * path; the driver holds it once, and no second wrapper is made after it does.
	 *
	 * The listener stays for the life of the session rather than of its runtime: a restart starts a
	 * new kernel in the same session without firing onDidStartRuntime again, and that kernel opens
	 * comms of its own.
	 */
	private async watchRuntimeConnections(session: ILanguageRuntimeSession) {
		// Whether a comm has opened, or the session has ended, since the comms already open were
		// listed. Either is newer than anything those comms report, which then must not replace it.
		let superseded = false;
		const store = new DisposableStore();
		store.add(session.onDidCreateClientInstance(({ message, client }) => {
			if (client.getClientType() === RuntimeClientType.Connection) {
				superseded = true;
				const metadata = message.data as Partial<IConnectionMetadata> | undefined;
				this.setSessionConnectionCode(session.sessionId, metadata?.code);
				if (!keepsConnectionComm(session, metadata)) {
					client.dispose();
				} else {
					// Synchronously, before anything awaits: the runtime sends focus right after
					// opening the comm, and only a wrapper that exists by then can hear it.
					this.keepRuntimeConnection(session, client, metadata);
				}
			}
		}));
		store.add(session.onDidEndSession(() => {
			superseded = true;
			// Whatever the runtime was connected to went with it.
			this.setSessionConnectionCode(session.sessionId, undefined);
			this.removeRuntimeSession(session.sessionId);
		}));
		this.watchConnectionsListeners.set(session.sessionId, store);

		try {
			const clients = await session.listClients(RuntimeClientType.Connection);
			// With several open, nothing says which the session opened last, so none of them says
			// where it is. Left unknown rather than guessed: a wrong code would have a SQL file's
			// statement run in a session on another database.
			const sole = clients.length === 1;
			await Promise.all(clients.map(async client => {
				// A comm that opened after the listener was added is delivered on both paths, and
				// a second wrapper would close it when released.
				if (this.runtimeDriverHolds(session.sessionId, client.getClientId())) {
					return;
				}
				const connection = new ConnectionsClientInstance(client);
				let keep = false;
				let metadata: IConnectionMetadata | undefined;
				try {
					// Bounded, so a comm that never answers is still decided on.
					metadata = await raceTimeout(connection.getMetadata(), STARTUP_METADATA_TIMEOUT_MS)
						.catch(e => {
							this.logService.error('Error while reading a runtime connection\'s metadata', e);
							return undefined;
						});
					// Ark answers only when R is idle, so a window reloaded during a long computation
					// sees every R comm time out; closing them would disconnect the user's objects.
					keep = keepsConnectionComm(session, metadata);
					if (metadata && sole && !superseded) {
						this.setSessionConnectionCode(session.sessionId, metadata.code);
					}
				} finally {
					if (keep) {
						// If the comm arrived on the other path while its metadata was pending, the
						// driver holds that path's wrapper, and this one is only released.
						if (!this.runtimeDriverHolds(session.sessionId, client.getClientId())) {
							this.addRuntimeConnection(session, connection, metadata);
						}
						this.releaseWhenClosed(connection);
					} else {
						connection.dispose();
						client.dispose();
					}
				}
			}));
		} catch (e) {
			this.logService.error('Error while watching runtime connections', e);
		}
	}

	/**
	 * Keeps a comm that arrived on the new-comm path: wraps it once and hands it to the runtime
	 * driver for its language, if any. The wrapper is released once the comm closes.
	 */
	private keepRuntimeConnection(
		session: ILanguageRuntimeSession,
		client: IRuntimeClientInstance<unknown, unknown>,
		metadata: Partial<IConnectionMetadata> | undefined,
	) {
		if (this.runtimeDriverHolds(session.sessionId, client.getClientId())) {
			return;
		}
		const languageId = metadata?.language_id ?? session.runtimeMetadata.languageId;
		if (!isRuntimeConnectionLanguage(languageId)) {
			// Kept with no row, and no wrapper to release.
			return;
		}
		const connection = new ConnectionsClientInstance(client);
		this.addRuntimeConnection(session, connection, metadata);
		this.releaseWhenClosed(connection);
	}

	/**
	 * The code behind the connection comm a session opened most recently, or undefined if it has
	 * opened none since Positron started watching it.
	 *
	 * A ggsql session holds one database at a time and opens a comm whenever that changes, with
	 * `-- @connect: <uri>` as its code, so for ggsql this says which database the session is on.
	 * Positron closes ggsql comms on arrival (others stay open; see watchRuntimeConnections), so the code is read on the way past: a ggsql session reconnected
	 * after a reload has had its comm closed already, and reads as undefined until it connects
	 * again.
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
