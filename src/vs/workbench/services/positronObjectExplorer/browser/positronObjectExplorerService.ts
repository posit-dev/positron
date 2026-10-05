/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { raceTimeout, RunOnceScheduler } from '../../../../base/common/async.js';
import { basename } from '../../../../base/common/resources.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { parseVariablePath } from '../../positronDataExplorer/common/utils.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { JSON_IDENTIFIER_PREFIX, PositronObjectExplorerUri } from '../common/positronObjectExplorerUri.js';
import { JsonObjectExplorerBackend } from '../common/jsonObjectExplorerBackend.js';
import { ObjectExplorerCommBackend } from '../common/objectExplorerCommBackend.js';
import { PositronObjectExplorerInstance } from './positronObjectExplorerInstance.js';
import { IPositronObjectExplorerService } from './interfaces/positronObjectExplorerService.js';
import { IPositronObjectExplorerInstance } from './interfaces/positronObjectExplorerInstance.js';
import { ObjectExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService.js';

// Registers the objectExplorer.* settings.
import './positronObjectExplorerConfiguration.js';

/**
 * How long to wait for a JSON file to settle after it changes before reloading it.
 */
const JSON_RELOAD_DELAY_MS = 250;

/**
 * The language name of instances backed by JSON files.
 */
const JSON_LANGUAGE_NAME = 'JSON';

/**
 * PositronObjectExplorerService class.
 */
export class PositronObjectExplorerService extends Disposable implements IPositronObjectExplorerService {
	declare readonly _serviceBrand: undefined;

	// The instances, keyed by identifier.
	private readonly _instances = new Map<string, PositronObjectExplorerInstance>();

	// For each instance, a store holding the instance and the listeners on it.
	private readonly _instanceStores = this._register(new DisposableMap<string, DisposableStore>());

	// The client-creation listener for each session, keyed by session ID.
	private readonly _sessionListeners = this._register(new DisposableMap<string>());

	// Variable ID to instance identifier.
	private readonly _varIdToInstanceId = new Map<string, string>();

	// `JSON.stringify([sessionId, variablePath])` to instance identifier.
	private readonly _variablePathToInstanceId = new Map<string, string>();

	private readonly _onDidRegisterInstanceEmitter = this._register(new Emitter<IPositronObjectExplorerInstance>());
	readonly onDidRegisterInstance = this._onDidRegisterInstanceEmitter.event;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();

		for (const session of this._runtimeSessionService.activeSessions) {
			void this.attachSession(session);
		}
		this._register(this._runtimeSessionService.onWillStartSession(e => this.attachSession(e.session)));
	}

	//#region IPositronObjectExplorerService Implementation

	getInstance(identifier: string): IPositronObjectExplorerInstance | undefined {
		return this._instances.get(identifier);
	}

	async getInstanceAsync(identifier: string, timeoutMs = 5000): Promise<IPositronObjectExplorerInstance | undefined> {
		const existing = this._instances.get(identifier);
		if (existing) {
			return existing;
		}

		// Cancel the event promise when the timeout wins, so its listener is removed.
		const registered = Event.toPromise(Event.filter(
			this.onDidRegisterInstance,
			instance => instance.client.identifier === identifier
		));
		return raceTimeout(registered, timeoutMs, () => registered.cancel());
	}

	getInstanceForVar(variableId: string): IPositronObjectExplorerInstance | undefined {
		const identifier = this._varIdToInstanceId.get(variableId);
		return identifier === undefined ? undefined : this._instances.get(identifier);
	}

	setInstanceForVar(instanceId: string, variableId: string): void {
		this._varIdToInstanceId.set(variableId, instanceId);
	}

	getInstanceForVariablePath(sessionId: string, variablePath: string[]): IPositronObjectExplorerInstance | undefined {
		const identifier = this._variablePathToInstanceId.get(variablePathKey(sessionId, variablePath));
		return identifier === undefined ? undefined : this._instances.get(identifier);
	}

	closeInstance(identifier: string): void {
		const instance = this._instances.get(identifier);
		if (instance && !instance.isInline) {
			deleteValues(this._varIdToInstanceId, identifier);
			deleteValues(this._variablePathToInstanceId, identifier);
			this._instances.delete(identifier);
			this._instanceStores.deleteAndDispose(identifier);
		}
	}

	async openWithJsonFile(uri: URI): Promise<void> {
		const identifier = await this.loadJsonFile(uri);
		if (identifier) {
			await this.openEditor(identifier);
		}
	}

	async loadJsonFile(uri: URI): Promise<string | undefined> {
		const identifier = JSON_IDENTIFIER_PREFIX + uri.toString();
		if (this._instances.has(identifier)) {
			return identifier;
		}

		let value: unknown;
		try {
			value = await this.readJsonFile(uri);
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.jsonParseError',
				"Could not parse {0} as JSON: {1}",
				basename(uri),
				err instanceof Error ? err.message : String(err)
			));
			return undefined;
		}

		// Another caller may have loaded the file while this one was reading it.
		if (this._instances.has(identifier)) {
			return identifier;
		}

		const backend = new JsonObjectExplorerBackend(identifier, basename(uri), value);
		const client = new ObjectExplorerClientInstance(backend);
		this.registerInstance(JSON_LANGUAGE_NAME, client, false, uri, undefined);
		this._instanceStores.get(identifier)?.add(this.watchJsonFile(uri, backend, client));
		return identifier;
	}

	//#endregion IPositronObjectExplorerService Implementation

	//#region Private Methods

	/**
	 * Starts listening to a session for object explorer comms. When a session is reattached (e.g.
	 * after an extension host restart), picks up the comms it already has open once it is idle.
	 */
	private async attachSession(session: ILanguageRuntimeSession): Promise<void> {
		const reattaching = this._sessionListeners.has(session.sessionId);
		this._sessionListeners.set(session.sessionId, session.onDidCreateClientInstance(e => {
			if (e.client.getClientType() !== RuntimeClientType.ObjectExplorer) {
				return;
			}
			this.registerClient(
				session,
				e.client,
				e.message.data?.inline_only === true,
				parseVariablePath(e.message.data?.variable_path)
			);
		}));

		if (!reattaching) {
			return;
		}
		if (session.getRuntimeState() !== RuntimeState.Idle) {
			await Event.toPromise(Event.filter(session.onDidChangeRuntimeState, state => state === RuntimeState.Idle));
		}

		let clients: IRuntimeClientInstance<unknown, unknown>[] = [];
		try {
			clients = await session.listClients(RuntimeClientType.ObjectExplorer);
		} catch (err) {
			this._logService.error('Error listing Object Explorer clients:', err);
		}
		for (const client of clients) {
			if (!this._instances.has(client.getClientId())) {
				this.registerClient(session, client, false, undefined);
			}
		}
	}

	/**
	 * Wraps a runtime comm in an instance and, unless it is inline, opens an editor for it.
	 */
	private registerClient(
		session: ILanguageRuntimeSession,
		runtimeClient: IRuntimeClientInstance<unknown, unknown>,
		inline: boolean,
		variablePath: string[] | undefined
	): void {
		try {
			const client = new ObjectExplorerClientInstance(new ObjectExplorerCommBackend(runtimeClient));
			this.registerInstance(session.runtimeMetadata.languageName, client, inline, undefined, session.sessionId);
			if (variablePath && variablePath.length > 0) {
				this._variablePathToInstanceId.set(variablePathKey(session.sessionId, variablePath), client.identifier);
			}
			if (!inline) {
				void this.openEditor(client.identifier);
			}
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.cannotOpen',
				"Can't open the Object Explorer: {0}",
				err instanceof Error ? err.message : String(err)
			));
		}
	}

	/**
	 * Registers an instance for a client so that editors can find it.
	 */
	private registerInstance(languageName: string, client: ObjectExplorerClientInstance, inline: boolean, fileUri: URI | undefined, sessionId: string | undefined): PositronObjectExplorerInstance {
		const store = new DisposableStore();
		const instance = store.add(this._instantiationService.createInstance(PositronObjectExplorerInstance, languageName, client, inline, fileUri, sessionId));
		const identifier = client.identifier;
		this._instances.set(identifier, instance);
		this._instanceStores.set(identifier, store);

		// When the object goes away, forget the variable bindings, but keep the instance: an open
		// editor still shows it, closed, until the user closes the editor.
		store.add(instance.onDidClose(() => {
			deleteValues(this._varIdToInstanceId, identifier);
			deleteValues(this._variablePathToInstanceId, identifier);
		}));

		this._onDidRegisterInstanceEmitter.fire(instance);
		return instance;
	}

	/**
	 * Reads and parses a JSON file.
	 */
	private async readJsonFile(uri: URI): Promise<unknown> {
		const content = await this._fileService.readFile(uri);
		return JSON.parse(content.value.toString());
	}

	/**
	 * Reloads a JSON file's backend when the file changes, and closes it when the file is deleted.
	 * While the file can't be parsed, the previous value stays and the client reports the error.
	 */
	private watchJsonFile(uri: URI, backend: JsonObjectExplorerBackend, client: ObjectExplorerClientInstance): IDisposable {
		const store = new DisposableStore();

		// Editors save in bursts, so wait for the file to settle.
		const reload = store.add(new RunOnceScheduler(async () => {
			try {
				const value = await this.readJsonFile(uri);
				client.setError(undefined);
				backend.setRoot(value);
			} catch (err) {
				client.setError(localize(
					'positron.objectExplorer.jsonReloadError',
					"Could not parse {0} as JSON: {1}",
					basename(uri),
					err instanceof Error ? err.message : String(err)
				));
			}
		}, JSON_RELOAD_DELAY_MS));

		const watcher = store.add(this._fileService.createWatcher(uri, { recursive: false, excludes: [] }));
		store.add(watcher.onDidChange(e => {
			if (e.contains(uri, FileChangeType.DELETED)) {
				backend.close();
			} else if (e.contains(uri, FileChangeType.UPDATED, FileChangeType.ADDED)) {
				reload.schedule();
			}
		}));

		return store;
	}

	/**
	 * Opens the editor for an instance.
	 */
	private async openEditor(identifier: string): Promise<void> {
		const editorPane = await this._editorService.openEditor({
			resource: PositronObjectExplorerUri.generate(identifier),
			options: { pinned: true }
		});
		if (!editorPane) {
			this._notificationService.error(localize(
				'positron.objectExplorer.couldNotOpenEditor',
				"An editor could not be opened."
			));
		}
	}

	//#endregion Private Methods
}

/**
 * Builds the key for a variable path within a session.
 */
function variablePathKey(sessionId: string, variablePath: string[]): string {
	return JSON.stringify([sessionId, variablePath]);
}

/**
 * Deletes every entry of a map whose value is the specified value.
 */
function deleteValues<K, V>(map: Map<K, V>, value: V): void {
	for (const [key, entryValue] of map) {
		if (entryValue === value) {
			map.delete(key);
		}
	}
}

registerSingleton(IPositronObjectExplorerService, PositronObjectExplorerService, InstantiationType.Delayed);
