/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from '../../../contrib/positronDataConnections/browser/positronDataConnectionsConfiguration.js';
import { connectDataConnectionWith } from '../../../contrib/positronDataConnections/browser/dataConnectionConnectWith.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IDataConnectionSchemaSummaryOptions, IDataConnectionSchemaWalk, walkDataConnectionSchema } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionParameterValues, IDataConnectionCodeVariant, IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionHandle, IDataConnectionMechanism, IDataConnectionParameter, IDataConnectionProfile, IDataConnectionQueryCodeRequest, IDiscoveredDataConnection } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionDriverMetadataDTO, IDataConnectionDriverSummaryDTO, IDataConnectionMechanismDTO, IDataConnectionNodeDTO, IDataConnectionParameterDTO, IDataConnectionSessionBindingDTO, IDataConnectionSummaryDTO } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { ExtHostDataConnectionsShape, ExtHostPositronContext, MainPositronContext, MainThreadDataConnectionsShape } from '../../common/positron/extHost.positron.protocol.js';

/**
 * Narrows a wire-format IDataConnectionParameterDTO to the service-level
 * IDataConnectionParameter discriminated union, picking up only the fields each variant carries.
 */
function dtoToServiceParameter(dto: IDataConnectionParameterDTO): IDataConnectionParameter {
	const base = { id: dto.id, label: dto.label, description: dto.description, required: dto.required };
	switch (dto.type) {
		case 'boolean':
			return { ...base, type: 'boolean', defaultValue: dto.defaultValue as boolean | undefined };
		case 'file':
			return {
				...base, type: 'file', defaultValue: dto.defaultValue as string | undefined, placeholder: dto.placeholder,
				// Convert the wire-format filters dictionary (label -> extensions) to the ordered
				// FileFilter array the file dialog service consumes. Insertion order is preserved,
				// so the driver's first filter remains the picker's default selection.
				filters: dto.filters && Object.entries(dto.filters).map(([name, extensions]) => ({ name, extensions })),
			};
		case 'number':
			return { ...base, type: 'number', defaultValue: dto.defaultValue as number | undefined, placeholder: dto.placeholder };
		case 'option':
			return { ...base, type: 'option', options: dto.options ?? [], defaultValue: dto.defaultValue as string | undefined, placeholder: dto.placeholder };
		case 'password':
			return { ...base, type: 'password', secret: true, placeholder: dto.placeholder };
		case 'string':
			if (dto.secret) {
				return { ...base, type: 'string', secret: true, masked: dto.masked, placeholder: dto.placeholder };
			}
			return { ...base, type: 'string', secret: false, defaultValue: dto.defaultValue as string | undefined, placeholder: dto.placeholder };
		default:
			throw new Error(`Unknown IDataConnectionParameterDTO type: ${dto.type}`);
	}
}

/**
 * Converts a wire-format mechanism DTO to the service-level shape, narrowing each of its parameters.
 */
function dtoToServiceMechanism(dto: IDataConnectionMechanismDTO): IDataConnectionMechanism {
	return {
		id: dto.id,
		label: dto.label,
		description: dto.description,
		parameters: dto.parameters.map(dtoToServiceParameter),
	};
}

/**
 * Converts a service-level mechanism back to the wire DTO shape for driver summaries returned to
 * the ext host. The service-level parameter variants are structurally assignable to the flat DTO
 * except for the file variant's filters, which flatten from the ordered FileFilter array back to
 * the wire's label -> extensions dictionary.
 */
function serviceMechanismToDto(mechanism: IDataConnectionMechanism): IDataConnectionMechanismDTO {
	return {
		...mechanism,
		parameters: mechanism.parameters.map((parameter): IDataConnectionParameterDTO => {
			if (parameter.type !== 'file') {
				return parameter;
			}
			const { filters, ...rest } = parameter;
			return {
				...rest,
				filters: filters && Object.fromEntries(filters.map(filter => [filter.name, filter.extensions])),
			};
		}),
	};
}

/**
 * Converts a wire-format driver metadata DTO to the service-level shape.
 */
function dtoToServiceMetadata(dto: IDataConnectionDriverMetadataDTO): IDataConnectionDriverMetadata {
	return {
		id: dto.id,
		name: dto.name,
		description: dto.description,
		iconSvg: dto.iconSvg,
		mechanisms: dto.mechanisms.map(dtoToServiceMechanism),
		supportedLanguageIds: dto.supportedLanguageIds,
	};
}

// Registers this class as a named customer so the extension host manager
// automatically instantiates it when the extension host connects, wiring up
// bidirectional RPC between MainThreadDataConnections and ExtHostDataConnections.
@extHostNamedCustomer(MainPositronContext.MainThreadDataConnections)

/**
 * Main thread counterpart to ExtHostDataConnections. Receives driver
 * registrations from the extension host and forwards them to the
 * IPositronDataConnectionsService so the UI can discover and use them.
 */
export class MainThreadDataConnections implements MainThreadDataConnectionsShape {

	// Proxy to call back into the extension host (e.g. $driverConnect, $connectionGetChildren).
	private readonly _proxy: ExtHostDataConnectionsShape;

	// The disposable store.
	private readonly _disposableStore = new DisposableStore();

	// Connection handles created via $connectToDataConnectionDriver, keyed by handle number.
	private readonly _connectionHandles = new Map<number, IDataConnectionHandle>();

	/**
	 * Constructor.
	 * @param extHostContext The extension host context, used to obtain the RPC proxy.
	 * @param _dataConnectionsService The data connections service for driver registration.
	 */
	constructor(
		extHostContext: IExtHostContext,
		@IPositronDataConnectionsService private readonly _dataConnectionsService: IPositronDataConnectionsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		// Get the ext host proxy so adapters can call back for connect/getChildren/etc.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostDataConnections);

		// Both events, because either can change what getConnections would answer: instances are
		// the connections that are live, profiles are the connections that exist at all.
		const notify = () => this._proxy.$onDidChangeDataConnections();
		this._disposableStore.add(this._dataConnectionsService.onDidChangeInstances(notify));
		this._disposableStore.add(this._dataConnectionsService.onDidChangeProfiles(notify));
	}

	/**
	 * Returns the connections the user has configured, live or not.
	 */
	async $getDataConnections(): Promise<IDataConnectionSummaryDTO[]> {
		if (!this._isEnabled()) {
			// An empty list and a disabled feature look the same to the caller, so the difference
			// is recorded here. Otherwise an extension reporting "no connections" is unexplainable
			// from the logs.
			this._logService.trace('[DataConnections] getConnections: the feature is disabled.');
			return [];
		}
		const live = new Set(
			this._dataConnectionsService.getInstances().map(instance => instance.profileId),
		);
		return this._dataConnectionsService.getProfiles().map(profile => ({
			profileId: profile.id,
			name: profile.connectionName,
			driverId: profile.driverMetadata.id,
			driverName: profile.driverMetadata.name,
			connected: live.has(profile.id),
			// From the profile rather than the registered driver, so a connection whose driver
			// extension has not activated yet still reports the languages it supports. The profile
			// records them when it is saved.
			supportedLanguageIds: profile.driverMetadata.supportedLanguageIds,
		}));
	}

	/**
	 * Reports every connection a runtime session already holds.
	 */
	async $getDataConnectionSessionBindings(sessionId: string): Promise<IDataConnectionSessionBindingDTO[]> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] getSessionBindings: the feature is disabled.');
			return [];
		}
		return this._dataConnectionsService.getSessionBindings(sessionId);
	}

	/**
	 * Shows the Connect With dialog for a profile and reports what the user connected.
	 *
	 * The dialog is the same one the pane opens, and is shown rather than skipped for the same
	 * reason it is there at all: which library to connect with, and whether to put a stored
	 * password into code that will run in the console, are the user's decisions.
	 */
	async $connectDataConnectionWith(
		profileId: string,
		languageId: string,
		takenVariableNames: string[],
	): Promise<IDataConnectionSessionBindingDTO | undefined> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] connectDataConnectionWith: the feature is disabled.');
			return undefined;
		}
		return connectDataConnectionWith(
			this._dataConnectionsService,
			this._notificationService,
			profileId,
			languageId,
			takenVariableNames,
		);
	}

	/**
	 * Records that a runtime session holds a connection to a profile, for one the caller arranged
	 * rather than one made through the dialog.
	 */
	async $registerDataConnectionSessionBinding(binding: IDataConnectionSessionBindingDTO): Promise<void> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] registerSessionBinding: the feature is disabled.');
			return;
		}
		this._dataConnectionsService.registerSessionBinding(binding);
	}

	/**
	 * Generates the code that runs a query through a connection a session holds.
	 *
	 * The profile's driver writes it, because only the driver knows what its own connection code
	 * created. Resolves to undefined when there is no such profile, its driver is not registered,
	 * or the driver cannot query that connection.
	 */
	async $generateDataConnectionQueryCode(binding: IDataConnectionSessionBindingDTO, query: string): Promise<string | undefined> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] generateQueryCode: the feature is disabled.');
			return undefined;
		}

		const profile = this._dataConnectionsService.getProfile(binding.profileId);
		const driver = profile && this._dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			this._logService.warn(`[DataConnections] generateQueryCode: no registered driver for profile ${binding.profileId}.`);
			return undefined;
		}

		const variantId = binding.variantId ?? await this._preferredVariantId(profile, driver, binding.languageId);
		if (!variantId) {
			this._logService.warn(`[DataConnections] generateQueryCode: ${profile.driverMetadata.name}`
				+ ` generates no ${binding.languageId} connection code, so there is no variant to assume.`);
			return undefined;
		}

		return driver.generateQueryCode({
			languageId: binding.languageId,
			variantId,
			connectionVariable: binding.variableName,
			query,
		});
	}

	/**
	 * The variant to assume for a binding that does not name one -- a connection the user made by
	 * hand and then pointed at, so Positron never saw which library made it.
	 *
	 * The profile's remembered preference, or the driver's default, which between them are what the
	 * Connect With dialog would have offered. A user who connected by hand almost certainly used
	 * the snippet that dialog suggests, and if they did not, the generated query will say so
	 * plainly by failing against the wrong kind of object rather than quietly doing the wrong
	 * thing.
	 */
	private async _preferredVariantId(
		profile: IDataConnectionProfile,
		driver: IDataConnectionDriver,
		languageId: string,
	): Promise<string | undefined> {
		const remembered = profile.preferredCodeVariants?.[languageId];
		let variants: IDataConnectionCodeVariant[];
		try {
			variants = await driver.generateConnectionCode(profile.mechanismId, languageId, profile.parameterValues);
		} catch (err) {
			this._logService.error(`[DataConnections] generateQueryCode: could not read ${profile.id}'s variants: ${err}`);
			return remembered;
		}
		return variants.some(variant => variant.id === remembered)
			? remembered
			: variants[0]?.id;
	}

	/**
	 * Opens the user's connection for a profile, if it is not already open.
	 *
	 * The service's connect is idempotent, so a profile that is already connected costs a lookup
	 * rather than a reconnect. The instance it returns is deliberately dropped: this exists so an
	 * extension can ask for a connection to be opened, not so it can hold one.
	 */
	async $openDataConnection(profileId: string): Promise<boolean> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] openConnection: the feature is disabled.');
			return false;
		}
		if (!this._dataConnectionsService.getProfile(profileId)) {
			// Nothing to open. A stale id is ordinary -- a caller may have recorded a profile the
			// user has since removed -- so this is not an error, just a no.
			this._logService.warn(`[DataConnections] openConnection: no profile ${profileId}.`);
			return false;
		}
		await this._dataConnectionsService.connect(profileId);
		return true;
	}

	/**
	 * Reads one live connection's schema tree.
	 *
	 * The walk rather than the rendered summary: an extension navigates the schema (a SQL editor
	 * resolving a table to its columns), so it wants the tree. The compact lines are for Assistant.
	 *
	 * The instance's own handle is used without being registered in `_connectionHandles`: that map
	 * is what `$releaseConnectionViaService` frees, and this connection belongs to the user rather
	 * than to the calling extension.
	 */
	async $getDataConnectionSchema(
		profileId: string,
		options: IDataConnectionSchemaSummaryOptions,
	): Promise<IDataConnectionSchemaWalk | undefined> {
		if (!this._isEnabled()) {
			this._logService.trace('[DataConnections] getSchema: the feature is disabled.');
			return undefined;
		}
		const instance = this._dataConnectionsService.getInstanceForProfile(profileId);
		if (!instance) {
			this._logService.warn(`[DataConnections] getSchema: profile ${profileId} has no live connection.`);
			return undefined;
		}
		const walk = await walkDataConnectionSchema(instance.connectionHandle, options);
		if (walk.truncated) {
			this._logService.trace(`[DataConnections] getSchema: profile ${profileId} was truncated by the caller's bounds.`);
		}
		return walk;
	}

	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === true;
	}

	/**
	 * Called by the ext host when an extension registers a data connection driver.
	 * Wraps the driver in an adapter and registers it with the service.
	 * @param driverId The unique identifier for the driver.
	 * @param metadata Serializable driver info (name, parameters, supported languages, etc.).
	 */
	$registerDataConnectionDriver(driverId: string, metadata: IDataConnectionDriverMetadataDTO): void {
		this._dataConnectionsService.driverManager.registerDriver(
			new MainThreadDataConnectionDriverAdapter(driverId, dtoToServiceMetadata(metadata), this._proxy)
		);
	}

	/**
	 * Called by the ext host when a driver is unregistered (its Disposable was disposed).
	 * @param driverId The unique identifier for the driver to remove.
	 */
	$removeDataConnectionDriver(driverId: string): void {
		this._dataConnectionsService.driverManager.removeDriver(driverId);
	}

	/**
	 * Returns summaries of all registered drivers from the service.
	 */
	async $getDataConnectionDrivers(): Promise<IDataConnectionDriverSummaryDTO[]> {
		return this._dataConnectionsService.driverManager.getDrivers().map(driver => ({
			id: driver.id,
			name: driver.metadata.name,
			description: driver.metadata.description,
			mechanisms: driver.metadata.mechanisms.map(serviceMechanismToDto),
			supportedLanguageIds: driver.metadata.supportedLanguageIds,
		}));
	}

	/**
	 * Connects to a driver via the service and returns a connection handle.
	 * This goes through the MainThreadDataConnectionDriverAdapter which calls
	 * back into the ext host via $driverConnect, exercising the full RPC
	 * round trip.
	 */
	async $connectToDataConnectionDriver(driverId: string, mechanismId: string, params: DataConnectionParameterValues): Promise<number> {
		const drivers = this._dataConnectionsService.driverManager.getDrivers();
		const driver = drivers.find(d => d.id === driverId);
		if (!driver) {
			throw new Error(`Data connection driver '${driverId}' not found`);
		}
		const handle = await driver.connect(mechanismId, params);
		this._connectionHandles.set(handle.handle, handle);
		return handle.handle;
	}

	/**
	 * Gets top-level children of a connection through the main thread handle.
	 */
	async $connectionGetChildrenViaService(connectionHandle: number): Promise<IDataConnectionNodeDTO[]> {
		return this._getHandle(connectionHandle).getChildren();
	}

	/**
	 * Disconnects a connection through the main thread handle.
	 */
	async $connectionDisconnectViaService(connectionHandle: number): Promise<void> {
		return this._getHandle(connectionHandle).disconnect();
	}

	/**
	 * Checks whether a connection is read-only through the main thread handle.
	 */
	async $connectionIsReadOnlyViaService(connectionHandle: number): Promise<boolean> {
		return this._getHandle(connectionHandle).isReadOnly();
	}

	/**
	 * Checks connection status through the main thread handle.
	 */
	async $connectionIsConnectedViaService(connectionHandle: number): Promise<boolean> {
		return this._getHandle(connectionHandle).isConnected();
	}

	/**
	 * Gets children of a node through the main thread handle.
	 */
	async $nodeGetChildrenViaService(connectionHandle: number, nodeHandle: number): Promise<IDataConnectionNodeDTO[]> {
		return this._getHandle(connectionHandle).nodeGetChildren(nodeHandle);
	}

	/**
	 * Previews a node through the main thread handle. Goes through the service rather than calling
	 * the handle directly so the resulting Data Explorer is recorded against the connection, the
	 * same as a preview started from the Data Connections panel.
	 */
	async $nodePreviewViaService(connectionHandle: number, nodeHandle: number): Promise<string | undefined> {
		return this._dataConnectionsService.previewNode(this._getHandle(connectionHandle), nodeHandle);
	}

	/**
	 * Releases a connection handle through the main thread handle.
	 */
	$releaseConnectionViaService(connectionHandle: number): void {
		const handle = this._connectionHandles.get(connectionHandle);
		if (handle) {
			handle.release();
			this._connectionHandles.delete(connectionHandle);
		}
	}

	private _getHandle(connectionHandle: number): IDataConnectionHandle {
		const handle = this._connectionHandles.get(connectionHandle);
		if (!handle) {
			throw new Error(`Connection handle ${connectionHandle} not found on the main thread`);
		}
		return handle;
	}

	// Called by the extension host manager when the extension host disconnects.
	dispose(): void {
		this._disposableStore.dispose();
	}
}

/**
 * Adapter that implements the service-level IDataConnectionDriver interface by
 * wrapping calls back through the RPC proxy to the extension host.
 */
class MainThreadDataConnectionDriverAdapter implements IDataConnectionDriver {
	/**
	 * Constructor.
	 * @param id The unique driver identifier.
	 * @param metadata Serializable driver info forwarded from the ext host.
	 * @param _proxy RPC proxy for calling back into the extension host.
	 */
	constructor(
		readonly id: string,
		readonly metadata: IDataConnectionDriverMetadata,
		private readonly _proxy: ExtHostDataConnectionsShape
	) { }

	/**
	 * Calls the extension's driver.connect() via RPC and wraps the returned
	 * connection handle in an adapter the service can operate on.
	 * @param mechanismId The id of the mechanism the user selected.
	 * @param params User-supplied parameter values from the connection dialog.
	 */
	async connect(mechanismId: string, params: DataConnectionParameterValues): Promise<IDataConnectionHandle> {
		// Ask the ext host to call driver.connect(); returns an integer handle.
		const connectionHandle = await this._proxy.$driverConnect(this.id, mechanismId, params);

		// Wrap the handle so the service can call getChildren/disconnect/etc.
		return new MainThreadDataConnectionHandleAdapter(connectionHandle, this._proxy);
	}

	/**
	 * Asks the ext host to run driver.generateConnectionCode() via RPC, returning the available
	 * code variants. An empty array means code could not be generated from the given parameters.
	 * @param mechanismId The id of the mechanism the user selected.
	 * @param languageId One of the driver's supported language ids.
	 * @param params User-supplied parameter values from the connection dialog.
	 */
	async generateConnectionCode(mechanismId: string, languageId: string, params: DataConnectionParameterValues): Promise<IDataConnectionCodeVariant[]> {
		const variants = await this._proxy.$generateConnectionCode(this.id, mechanismId, languageId, params);
		return variants.map(variant => ({ id: variant.id, label: variant.label, code: variant.code }));
	}

	/**
	 * Asks the ext host to run driver.generateQueryCode() via RPC, returning the code that runs a
	 * query through a connection this driver's connection code made. Resolves to undefined when
	 * the driver does not implement query generation, or does not for that variant.
	 * @param request What to run and what to run it through.
	 */
	async generateQueryCode(request: IDataConnectionQueryCodeRequest): Promise<string | undefined> {
		return this._proxy.$generateQueryCode(this.id, request);
	}

	/**
	 * Asks the ext host to run driver.redactParameterValue() via RPC, returning a display-safe form of
	 * the stored secret value. Resolves to undefined when the driver does not implement redaction.
	 * @param mechanismId The id of the mechanism the connection was configured with.
	 * @param parameterId The id of the parameter to redact.
	 * @param value The stored cleartext parameter value.
	 */
	async redactParameterValue(mechanismId: string, parameterId: string, value: string): Promise<string | undefined> {
		return this._proxy.$redactParameterValue(this.id, mechanismId, parameterId, value);
	}

	/**
	 * Asks the ext host to run driver.discoverConnections() via RPC, listing the connections already
	 * configured on this machine. Resolves to an empty array for a driver that does not implement
	 * discovery.
	 */
	async discoverConnections(): Promise<IDiscoveredDataConnection[]> {
		const discovered = await this._proxy.$discoverConnections(this.id);
		return discovered.map(connection => ({
			id: connection.id,
			name: connection.name,
			description: connection.description,
			mechanismId: connection.mechanismId,
			parameterValues: connection.parameters,
		}));
	}
}

/**
 * Adapter that wraps a connection handle, delegating all operations back to
 * the extension host through the RPC proxy.
 */
class MainThreadDataConnectionHandleAdapter implements IDataConnectionHandle {
	/**
	 * Constructor.
	 * @param handle The integer connection handle assigned by the ext host.
	 * @param _proxy RPC proxy for calling back into the extension host.
	 */
	constructor(
		readonly handle: number,
		private readonly _proxy: ExtHostDataConnectionsShape
	) { }

	/**
	 * Checks whether the extension-side connection is read-only.
	 */
	async isReadOnly(): Promise<boolean> {
		return this._proxy.$connectionIsReadOnly(this.handle);
	}

	/**
	 * Fetches top-level children (databases, schemas, etc.) from the ext host.
	 */
	async getChildren(): Promise<IDataConnectionNodeDTO[]> {
		return this._proxy.$connectionGetChildren(this.handle);
	}

	/**
	 * Tells the extension to disconnect but keeps the handle alive.
	 */
	async disconnect(): Promise<void> {
		return this._proxy.$connectionDisconnect(this.handle);
	}

	/**
	 * Checks whether the extension-side connection is still active.
	 */
	async isConnected(): Promise<boolean> {
		return this._proxy.$connectionIsConnected(this.handle);
	}

	/**
	 * Expands a specific node in the tree by its handle.
	 */
	async nodeGetChildren(nodeHandle: number): Promise<IDataConnectionNodeDTO[]> {
		return this._proxy.$nodeGetChildren(this.handle, nodeHandle);
	}

	/**
	 * Triggers a data preview for the given node (e.g. table contents), resolving to the dataset id
	 * the extension opened it under, if it reported one.
	 */
	async nodePreview(nodeHandle: number): Promise<string | undefined> {
		return this._proxy.$nodePreview(this.handle, nodeHandle);
	}

	/**
	 * Frees this connection handle and all associated node handles in the ext host.
	 */
	release(): void {
		this._proxy.$releaseConnection(this.handle);
	}
}
