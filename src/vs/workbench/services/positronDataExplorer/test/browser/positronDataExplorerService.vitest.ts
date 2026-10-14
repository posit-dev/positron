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
import { IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorPane } from '../../../../common/editor.js';
import { IEditorService } from '../../../editor/common/editorService.js';
import { IExtensionService } from '../../../extensions/common/extensions.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { BackendState, DataExplorerBackendRequest, DataExplorerFrontendEvent, SupportedFeatures, SupportStatus } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { IDataExplorerRpcTransport } from '../../common/dataExplorerRpcTransport.js';
import { DUCKDB_DATA_EXPLORER_PROVIDER_ID } from '../../common/positronDataExplorerDuckDBBackend.js';
import { PositronDataExplorerService } from '../../browser/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../browser/interfaces/positronDataExplorerInstance.js';

/** Everything unsupported; these tests exercise the instance lifecycle, not grid features. */
const NO_FEATURES: SupportedFeatures = {
	search_schema: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_row_filters: { support_status: SupportStatus.Unsupported, supports_conditions: SupportStatus.Unsupported, supported_types: [] },
	get_column_profiles: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_sort_columns: { support_status: SupportStatus.Unsupported },
	export_data_selection: { support_status: SupportStatus.Unsupported, supported_formats: [] },
	convert_to_code: { support_status: SupportStatus.Unsupported },
};

const CONNECTION_PROVIDER_ID = 'positron-data-driver-duckdb';
const TABLE_DATASET_ID = 'duckdbconn:1:table:main.bikes';
const FILE_URI = URI.file('/tmp/bikes.csv');

/** How a Data Explorer is opened, and the keys the service tracks it under. */
interface EntryPoint {
	name: string;
	open: (service: PositronDataExplorerService) => Promise<void>;
	/** The client id: the instance key and editor URI identifier. */
	identifier: string;
	/** The dataset uri: the RPC `uri` and the key UI events are routed by. */
	datasetUri: string;
	providerId: string;
}

const TABLE: EntryPoint = {
	name: 'a Data Connections table',
	open: service => service.openWithExtensionBackend({
		providerId: CONNECTION_PROVIDER_ID,
		datasetId: TABLE_DATASET_ID,
		displayName: 'bikes',
	}),
	identifier: TABLE_DATASET_ID,
	datasetUri: TABLE_DATASET_ID,
	providerId: CONNECTION_PROVIDER_ID,
};

const FILE: EntryPoint = {
	name: 'a DuckDB file',
	open: service => service.openWithDuckDB(FILE_URI),
	identifier: `duckdb:${FILE_URI.toString()}`,
	datasetUri: FILE_URI.toString(),
	providerId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
};

describe('PositronDataExplorerService extension-backed explorers', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IEditorService, stubInterface<IEditorService>({
			// openEditor is overloaded; the service only calls the IResourceEditorInput signature.
			openEditor: (async (_editor: IResourceEditorInput): Promise<IEditorPane | undefined> =>
				stubInterface<IEditorPane>()) as IEditorService['openEditor'],
		}))
		.stub(IExtensionService, stubInterface<IExtensionService>({
			activateByEvent: async () => { },
		}))
		.stub(IRuntimeSessionService, {
			activeSessions: [],
			onWillStartSession: Event.None,
			onDidStartRuntime: Event.None,
			onDidFailStartRuntime: Event.None,
			onDidChangeRuntimeState: Event.None,
		})
		.build();

	let service: PositronDataExplorerService;
	let disposables: DisposableStore;

	/** The `disposeBackend` notifications the providers received, in order. */
	let disposedBackends: Array<{ providerId: string; datasetId: string }>;

	const backendState = (): BackendState => ({
		display_name: 'bikes',
		table_shape: { num_rows: 0, num_columns: 0 },
		table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: NO_FEATURES,
	});

	beforeEach(() => {
		// PositronDataExplorerInstance reads the singleton in its constructor.
		PositronReactServices.services = ctx.reactServices;
		disposables = ctx.disposables.add(new DisposableStore());
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronDataExplorerService));

		disposedBackends = [];
		const transport: IDataExplorerRpcTransport = {
			handleRpc: async (_providerId, rpc) => ({
				result: rpc.method === DataExplorerBackendRequest.GetState ? backendState() : {}
			}),
			disposeBackend: (providerId, datasetId) => {
				disposedBackends.push({ providerId, datasetId });
			},
		};
		service.registerRpcProvider(CONNECTION_PROVIDER_ID, transport);
		service.registerRpcProvider(DUCKDB_DATA_EXPLORER_PROVIDER_ID, transport);
	});

	/** Closes the explorer's editor tab, as PositronDataExplorerEditorInput.dispose does. */
	function closeTab(instance: IPositronDataExplorerInstance) {
		instance.dataExplorerClientInstance.dispose();
	}

	/** Counts the data-update UI events that reach the instance's backend. */
	function countDataUpdates(instance: IPositronDataExplorerInstance) {
		const counter = { count: 0 };
		disposables.add(instance.dataExplorerClientInstance.backendClient.onDidDataUpdate(() => counter.count++));
		return counter;
	}

	/** Sends a data-update UI event for the dataset, as a providing extension does. */
	function sendDataUpdate(entry: EntryPoint) {
		service.routeUiEvent({ uri: entry.datasetUri, method: DataExplorerFrontendEvent.DataUpdate, params: {} });
	}

	describe.each([TABLE, FILE])('for $name', entry => {
		it('opens a fresh explorer after its tab closes, and disposes the closed one', async () => {
			await entry.open(service);
			const closed = service.getInstance(entry.identifier)!;
			const disposeSpy = vi.spyOn(closed, 'dispose');

			closeTab(closed);
			const forgottenOnClose = service.getInstance(entry.identifier) === undefined;
			await entry.open(service);
			const reopened = service.getInstance(entry.identifier);

			// Compare instances rather than printing them: a failure diff of an instance would walk
			// into stubbed services, which throw on unexpected reads.
			expect({
				forgottenOnClose,
				closedDisposeCount: disposeSpy.mock.calls.length,
				reopenedIsFresh: reopened !== undefined && reopened !== closed,
			}).toEqual({
				forgottenOnClose: true,
				closedDisposeCount: 1,
				reopenedIsFresh: true,
			});
		});

		it('tells the provider each time a reopened explorer closes', async () => {
			await entry.open(service);
			closeTab(service.getInstance(entry.identifier)!);
			await entry.open(service);
			closeTab(service.getInstance(entry.identifier)!);

			const expected = { providerId: entry.providerId, datasetId: entry.datasetUri };
			expect(disposedBackends).toEqual([expected, expected]);
		});

		it('routes UI events to the reopened explorer, not the closed one', async () => {
			await entry.open(service);
			const closed = service.getInstance(entry.identifier)!;
			const closedUpdates = countDataUpdates(closed);
			closeTab(closed);
			sendDataUpdate(entry);

			await entry.open(service);
			const reopenedUpdates = countDataUpdates(service.getInstance(entry.identifier)!);
			sendDataUpdate(entry);

			expect({ closed: closedUpdates.count, reopened: reopenedUpdates.count }).toEqual({ closed: 0, reopened: 1 });
		});
	});

	it('focuses an open table rather than building a second explorer for it', async () => {
		await TABLE.open(service);
		const first = service.getInstance(TABLE.identifier);
		await TABLE.open(service);

		expect(service.getInstance(TABLE.identifier) === first).toBe(true);
	});

	it('keeps a newer explorer for the same dataset when an older one closes', async () => {
		// openWithDuckDB always builds a new explorer, replacing any registered for the same file.
		await FILE.open(service);
		const older = service.getInstance(FILE.identifier)!;
		await FILE.open(service);
		const newer = service.getInstance(FILE.identifier)!;
		const newerUpdates = countDataUpdates(newer);

		closeTab(older);
		sendDataUpdate(FILE);

		expect({
			current: service.getInstance(FILE.identifier) === newer,
			newerUpdates: newerUpdates.count,
		}).toEqual({ current: true, newerUpdates: 1 });
	});
});
