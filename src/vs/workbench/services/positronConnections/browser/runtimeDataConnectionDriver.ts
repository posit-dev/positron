/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { RuntimeClientState } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { PYTHON_ICON_BASE64, R_ICON_BASE64 } from '../../positronDataConnections/common/languageIcons.js';
import { DataConnectionParameterValues, IDataConnectionCodeVariant, IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionParameterValidation, IDiscoveredDataConnection } from '../../positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IConnectionMetadata } from '../common/interfaces/positronConnectionsInstance.js';
import { nextRuntimeConnectionHandle, RUNTIME_CONNECTION_ID_PARAMETER, RUNTIME_CONNECTION_MECHANISM_ID, RuntimeConnectionLanguage, runtimeDataConnectionDriverId } from '../common/runtimeDataConnections.js';
import { RuntimeConnectionHandle } from './runtimeConnectionHandle.js';

/**
 * A live connection comm held by a runtime data connection driver.
 */
export interface IRuntimeConnectionEntry {
	/** The id of the runtime session that owns the comm. */
	readonly sessionId: string;
	/** The display name of that session. */
	readonly sessionName: string;
	/** The connection comm client. Owned by the runtime session, never disposed by the driver. */
	readonly client: ConnectionsClientInstance;
	/** The metadata the runtime reported for the connection. */
	readonly metadata: IConnectionMetadata;
}

/**
 * Holds the live connection comms of one runtime language and reports them as discovered data
 * connections. It never closes a comm except when the user disconnects through a handle.
 */
export class RuntimeDataConnectionDriver extends Disposable implements IDataConnectionDriver {
	private readonly _entries = new Map<string, IRuntimeConnectionEntry>();

	private readonly _handles = new Map<string, RuntimeConnectionHandle>();

	/** Per-connection listeners and handle. Removing an entry disposes these, not its client. */
	private readonly _stores = this._register(new DisposableMap<string, DisposableStore>());

	private readonly _onDidFocus = this._register(new Emitter<string>());

	private readonly _onDidUpdate = this._register(new Emitter<string>());

	/** Fires with a connection id when the runtime asks to focus that connection. */
	readonly onDidFocus: Event<string> = this._onDidFocus.event;

	/** Fires with a connection id when the runtime reports that connection changed. */
	readonly onDidUpdate: Event<string> = this._onDidUpdate.event;

	readonly id: string;

	readonly metadata: IDataConnectionDriverMetadata;

	/**
	 * @param languageId The runtime language this driver serves.
	 * @param _onDidChange Called once for each connection added or removed.
	 */
	constructor(
		languageId: RuntimeConnectionLanguage,
		private readonly _onDidChange: () => void,
	) {
		super();
		this.id = runtimeDataConnectionDriverId(languageId);
		const isR = languageId === 'r';
		this.metadata = {
			id: this.id,
			name: isR
				? localize('positron.dataConnections.runtimeDriverR', "R Session")
				: localize('positron.dataConnections.runtimeDriverPython', "Python Session"),
			description: '',
			iconSvg: decodeBase64(isR ? R_ICON_BASE64 : PYTHON_ICON_BASE64).toString(),
			mechanisms: [{
				id: RUNTIME_CONNECTION_MECHANISM_ID,
				label: localize('positron.dataConnections.runtimeMechanismLive', "Live"),
				description: '',
				parameters: [{
					id: RUNTIME_CONNECTION_ID_PARAMETER,
					label: localize('positron.dataConnections.runtimeParameterConnection', "Connection"),
					type: 'string',
				}],
			}],
			// Runtime connections never generate code (Decision 7), so no language is supported.
			supportedLanguageIds: [],
		};
	}

	/**
	 * Adds a live connection comm. Adding an id the driver already holds changes nothing. A comm
	 * that is already closed is not held, since nothing could ever remove it.
	 * @param entry The connection to add.
	 * @returns The connection id, `<sessionId>:<clientId>`.
	 */
	addConnection(entry: IRuntimeConnectionEntry): string {
		const connectionId = `${entry.sessionId}:${entry.client.getClientId()}`;
		if (this._entries.has(connectionId) || entry.client.clientState.get() === RuntimeClientState.Closed) {
			return connectionId;
		}
		this._entries.set(connectionId, entry);
		const store = new DisposableStore();
		this._stores.set(connectionId, store);
		store.add(entry.client.onDidClose(() => this._remove(connectionId)));
		store.add(entry.client.onDidFocus(() => this._onDidFocus.fire(connectionId)));
		store.add(entry.client.onDidUpdate(() => this._onDidUpdate.fire(connectionId)));
		this._onDidChange();
		return connectionId;
	}

	/**
	 * Whether the driver holds a comm.
	 * @param sessionId The owning session id.
	 * @param clientId The comm's client id.
	 */
	hasConnection(sessionId: string, clientId: string): boolean {
		return this._entries.has(`${sessionId}:${clientId}`);
	}

	/**
	 * Drops every comm of a session, without closing them.
	 * @param sessionId The session id.
	 */
	removeSession(sessionId: string): void {
		for (const [connectionId, entry] of [...this._entries]) {
			if (entry.sessionId === sessionId) {
				this._remove(connectionId);
			}
		}
	}

	/**
	 * Gets the handle created for a connection, if connect() has been called for it.
	 * @param connectionId The connection id.
	 */
	getHandle(connectionId: string): RuntimeConnectionHandle | undefined {
		return this._handles.get(connectionId);
	}

	async connect(mechanismId: string, params: DataConnectionParameterValues): Promise<RuntimeConnectionHandle> {
		const connectionId = String(params[RUNTIME_CONNECTION_ID_PARAMETER]);
		const entry = this._entries.get(connectionId);
		if (!entry) {
			throw new Error(localize('positron.dataConnections.noLiveRuntimeConnection', "No live runtime connection '{0}'", connectionId));
		}
		let handle = this._handles.get(connectionId);
		if (!handle) {
			handle = new RuntimeConnectionHandle(nextRuntimeConnectionHandle(), entry.client, () => this._remove(connectionId), entry.metadata.name);
			this._handles.set(connectionId, handle);
			this._stores.get(connectionId)?.add(handle);
		}
		return handle;
	}

	async generateConnectionCode(_mechanismId: string, _languageId: string, _params: DataConnectionParameterValues): Promise<IDataConnectionCodeVariant[]> {
		return [];
	}

	async redactParameterValue(_mechanismId: string, _parameterId: string, _value: string): Promise<string | undefined> {
		return undefined;
	}

	async validateParameters(_mechanismId: string, _params: DataConnectionParameterValues): Promise<IDataConnectionParameterValidation> {
		return {};
	}

	async discoverConnections(): Promise<IDiscoveredDataConnection[]> {
		return [...this._entries].map(([connectionId, entry]) => ({
			id: connectionId,
			name: entry.metadata.name,
			description: entry.metadata.host
				// The same middle dot the row puts between the name and this description.
				? `${entry.sessionName} \u00B7 ${entry.metadata.host}`
				: entry.sessionName,
			mechanismId: RUNTIME_CONNECTION_MECHANISM_ID,
			parameterValues: { [RUNTIME_CONNECTION_ID_PARAMETER]: connectionId },
		}));
	}

	/** Removes a connection. Safe to call any number of times for the same id. */
	private _remove(connectionId: string): void {
		if (!this._entries.delete(connectionId)) {
			return;
		}
		// Close the handle first: disposing the store below removes its comm listener.
		this._handles.get(connectionId)?.markClosed();
		this._handles.delete(connectionId);
		this._stores.deleteAndDispose(connectionId);
		this._onDidChange();
	}
}
