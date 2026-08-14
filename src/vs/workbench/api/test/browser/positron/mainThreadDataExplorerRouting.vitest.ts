/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { MainThreadDataExplorer } from '../../../browser/positron/mainThreadDataExplorer.js';
import { ExtHostDataExplorerShape } from '../../../common/positron/extHost.positron.protocol.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { BackendState, DataExplorerBackendRequest, SupportedFeatures, SupportStatus } from '../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { IDataExplorerRpcDto } from '../../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';
import { DUCKDB_DATA_EXPLORER_PROVIDER_ID } from '../../../../services/positronDataExplorer/common/positronDataExplorerDuckDBBackend.js';
import { PositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/positronDataExplorerService.js';

/**
 * In the web workbench there are two extension hosts -- the browser web-worker host and the remote
 * server host -- so `MainThreadDataExplorer` (an `@extHostNamedCustomer`) is instantiated twice.
 * Native backends like positron-duckdb can only run in the remote host, so RPCs must reach the host
 * that registered the provider rather than whichever host connected most recently.
 */
/** Everything unsupported; this test exercises routing, not grid features. */
const NO_FEATURES: SupportedFeatures = {
	search_schema: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_row_filters: { support_status: SupportStatus.Unsupported, supports_conditions: SupportStatus.Unsupported, supported_types: [] },
	get_column_profiles: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_sort_columns: { support_status: SupportStatus.Unsupported },
	export_data_selection: { support_status: SupportStatus.Unsupported, supported_formats: [] },
	convert_to_code: { support_status: SupportStatus.Unsupported },
};

describe('Data Explorer RPC transport routing', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IEditorService, { openEditor: vi.fn().mockResolvedValue(undefined) })
		.stub(IRuntimeSessionService, {
			activeSessions: [],
			onWillStartSession: Event.None,
			onDidStartRuntime: Event.None,
			onDidFailStartRuntime: Event.None,
			onDidChangeRuntimeState: Event.None,
		})
		.build();

	let store: DisposableStore;
	let service: PositronDataExplorerService;

	beforeEach(() => {
		// PositronDataExplorerInstance reads the singleton in its constructor.
		PositronReactServices.services = ctx.reactServices;
		store = new DisposableStore();
		service = store.add(ctx.instantiationService.createInstance(PositronDataExplorerService));
	});

	afterEach(() => {
		store.dispose();
	});

	/** A minimal backend state, enough for the grid instances the open path spins up. */
	const backendState = (): BackendState => ({
		display_name: 'small_file.csv',
		table_shape: { num_rows: 0, num_columns: 0 },
		table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: NO_FEATURES,
	});

	/**
	 * Stands up one extension host's MainThreadDataExplorer over the service, recording its RPCs.
	 * @param providers Provider ids whose extensions are installed in this host; each registers its
	 * RPC handler when activated, as the real backends do.
	 */
	function createExtensionHost(providers: readonly string[] = []) {
		const calls: Array<{ providerId: string; rpc: IDataExplorerRpcDto }> = [];
		const proxy = stubInterface<ExtHostDataExplorerShape>({
			$handleRpc: (providerId: string, rpc: IDataExplorerRpcDto) => {
				calls.push({ providerId, rpc });
				return Promise.resolve({
					result: rpc.method === DataExplorerBackendRequest.GetState ? backendState() : {}
				});
			},
			$disposeBackend: () => { },
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => proxy as T) as IExtHostContext['getProxy'],
		});
		// The activation stub reaches back into the customer it belongs to, which doesn't exist yet.
		const host: { mainThread?: MainThreadDataExplorer } = {};
		const extensionService = stubInterface<IExtensionService>({
			activateByEvent: (event: string) => {
				// Activating a backend extension registers its RPC handler; a host that doesn't have the
				// extension installed just resolves.
				const providerId = providers.find(p => event === `onPositronDataExplorerBackend:${p}`);
				if (providerId) {
					host.mainThread?.$registerRpcHandler(providerId);
				}
				return Promise.resolve();
			},
		});
		host.mainThread = store.add(new MainThreadDataExplorer(extHostContext, service, extensionService));
		return { mainThread: host.mainThread, calls };
	}

	it('sends RPCs to the host that registered the provider, not the host that connected last', async () => {
		// The remote host owns positron-duckdb; the web-worker host connects afterwards and never
		// registers it, so it can never service a DuckDB RPC.
		const remoteHost = createExtensionHost();
		remoteHost.mainThread.$registerRpcHandler(DUCKDB_DATA_EXPLORER_PROVIDER_ID);
		const webWorkerHost = createExtensionHost();

		await service.openWithDuckDB(URI.file('/tmp/small_file.csv'));

		// The backend's bootstrap `open_dataset` is dispatched asynchronously; wait for it to land on
		// one of the hosts before asserting which one.
		await vi.waitFor(() => expect(remoteHost.calls.length + webWorkerHost.calls.length).toBeGreaterThan(0));

		expect({
			remoteFirstCall: remoteHost.calls[0]?.rpc.method,
			remoteProviderId: remoteHost.calls[0]?.providerId,
			webWorkerCallCount: webWorkerHost.calls.length,
		}).toEqual({
			remoteFirstCall: DataExplorerBackendRequest.OpenDataset,
			remoteProviderId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
			webWorkerCallCount: 0,
		});
	});

	it('finds the owning host when the provider only registers as it activates', async () => {
		// The lazy path: nothing has registered when the file is opened, so the owning host is only
		// identified by activating the provider in every connected host.
		const remoteHost = createExtensionHost([DUCKDB_DATA_EXPLORER_PROVIDER_ID]);
		const webWorkerHost = createExtensionHost();

		await service.openWithDuckDB(URI.file('/tmp/small_file.csv'));
		await vi.waitFor(() => expect(remoteHost.calls.length + webWorkerHost.calls.length).toBeGreaterThan(0));

		expect({
			remoteFirstCall: remoteHost.calls[0]?.rpc.method,
			webWorkerCallCount: webWorkerHost.calls.length,
		}).toEqual({
			remoteFirstCall: DataExplorerBackendRequest.OpenDataset,
			webWorkerCallCount: 0,
		});
	});

	it('sends RPCs to the only connected host in a single-host workbench', async () => {
		// Desktop has one extension host, so there is nothing to disambiguate.
		const host = createExtensionHost([DUCKDB_DATA_EXPLORER_PROVIDER_ID]);

		await service.openWithDuckDB(URI.file('/tmp/small_file.csv'));
		await vi.waitFor(() => expect(host.calls.length).toBeGreaterThan(0));

		expect(host.calls[0]?.rpc.method).toBe(DataExplorerBackendRequest.OpenDataset);
	});
});
