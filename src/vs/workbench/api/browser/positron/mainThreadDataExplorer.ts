/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerRpcTransport, IDataExplorerUiEventDto } from '../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';
import { IDataImporter, IDataImporterMetadata, IDataImportRequest, IDataImportResult, IPositronDataImporterRegistry } from '../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
import { ExtHostDataExplorerShape, ExtHostPositronContext, MainPositronContext, MainThreadDataExplorerShape } from '../../common/positron/extHost.positron.protocol.js';

/**
 * Activation event a Data Explorer backend extension declares so it activates lazily when a dataset
 * it owns is first accessed, rather than eagerly at startup. The provider id is the suffix, e.g.
 * `onPositronDataExplorerBackend:positron-duckdb`.
 */
function dataExplorerBackendActivationEvent(providerId: string): string {
	return `onPositronDataExplorerBackend:${providerId}`;
}

/**
 * Main thread counterpart to ExtHostDataExplorer. Acts as the {@link IDataExplorerRpcTransport} for
 * core Data Explorer backends -- forwarding each RPC over the typed ext-host channel to the
 * providing extension -- and routes the extension's frontend UI events and open requests into the
 * IPositronDataExplorerService. Registers itself as the service's transport for its lifetime.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadDataExplorer)
export class MainThreadDataExplorer implements MainThreadDataExplorerShape, IDataExplorerRpcTransport {

	private readonly _proxy: ExtHostDataExplorerShape;
	private readonly _disposables = new DisposableStore();

	/** Provider ids that have registered an RPC handler in the ext host (informational). */
	private readonly _providers = new Set<string>();

	/** Registry registrations for importers contributed by the ext host, keyed by handle. */
	private readonly _importerRegistrations = new Map<number, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronDataExplorerService private readonly _dataExplorerService: IPositronDataExplorerService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IPositronDataImporterRegistry private readonly _dataImporterRegistry: IPositronDataImporterRegistry
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostDataExplorer);
		// Become the transport core backends use to reach extensions for the ext host's lifetime.
		this._disposables.add(this._dataExplorerService.registerRpcTransport(this));
	}

	// --- IDataExplorerRpcTransport ---

	async handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto> {
		// Activate the providing extension if it hasn't been already: backends declare
		// `onPositronDataExplorerBackend:<providerId>` so they stay dormant until a dataset they own
		// is accessed. Idempotent and resolves immediately once activated. `$handleRpc` additionally
		// waits for the provider to register, covering the activation window.
		await this._extensionService.activateByEvent(dataExplorerBackendActivationEvent(providerId));
		return this._proxy.$handleRpc(providerId, rpc);
	}

	disposeBackend(providerId: string, datasetId: string): void {
		this._proxy.$disposeBackend(providerId, datasetId);
	}

	// --- MainThreadDataExplorerShape (called by the ext host) ---

	$registerRpcHandler(providerId: string): void {
		this._providers.add(providerId);
	}

	$unregisterRpcHandler(providerId: string): void {
		this._providers.delete(providerId);
	}

	$sendUiEvent(event: IDataExplorerUiEventDto): void {
		this._dataExplorerService.routeUiEvent(event);
	}

	$open(providerId: string, datasetId: string, displayName: string): Promise<void> {
		return this._dataExplorerService.openWithExtensionBackend({ providerId, datasetId, displayName });
	}

	$registerDataImporter(handle: number, metadata: IDataImporterMetadata): void {
		const importer: IDataImporter = {
			languageId: metadata.languageId,
			displayName: metadata.displayName,
			fileExtensions: metadata.fileExtensions,
			generateCode: (request: IDataImportRequest): Promise<IDataImportResult | undefined> =>
				this._proxy.$generateImportCode(handle, {
					fileUri: request.fileUri.toJSON(),
					variableName: request.variableName,
					options: request.options
				})
		};
		this._importerRegistrations.set(handle, this._dataImporterRegistry.registerImporter(importer));
	}

	$unregisterDataImporter(handle: number): void {
		this._importerRegistrations.get(handle)?.dispose();
		this._importerRegistrations.delete(handle);
	}

	dispose(): void {
		this._importerRegistrations.forEach(registration => registration.dispose());
		this._importerRegistrations.clear();
		this._disposables.dispose();
	}
}
