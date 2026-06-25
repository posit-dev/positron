/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronDataExplorerInstance } from '../../browser/positronDataExplorerInstance.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronDataExplorerDuckDBBackend } from '../../common/positronDataExplorerDuckDBBackend.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { BackendState, DatasetImportOptions, SchemaUpdateEvent, SetDatasetImportOptionsResult, SupportedFeatures, SupportStatus } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

/** Builds a typed mock of the DuckDB backend's setDatasetImportOptions; its return type also gives us the Mock type without importing from 'vitest'. */
const createSetImportOptionsStub = () =>
	vi.fn((_options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> => Promise.resolve({}));

/** A SupportedFeatures with everything unsupported; the file-options tests don't exercise grid features. */
const NO_FEATURES: SupportedFeatures = {
	search_schema: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_row_filters: { support_status: SupportStatus.Unsupported, supports_conditions: SupportStatus.Unsupported, supported_types: [] },
	get_column_profiles: { support_status: SupportStatus.Unsupported, supported_types: [] },
	set_sort_columns: { support_status: SupportStatus.Unsupported },
	export_data_selection: { support_status: SupportStatus.Unsupported, supported_formats: [] },
	convert_to_code: { support_status: SupportStatus.Unsupported },
};

describe('PositronDataExplorerInstance file options', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.build();

	let instance: PositronDataExplorerInstance;
	let setDatasetImportOptions: ReturnType<typeof createSetImportOptionsStub>;
	let backendState: BackendState;
	let disposables: DisposableStore;

	// A DuckDB-backed Excel workbook with two sheets.
	const makeBackendState = (): BackendState => ({
		display_name: 'book.xlsx',
		table_shape: { num_rows: 2, num_columns: 2 },
		table_unfiltered_shape: { num_rows: 2, num_columns: 2 },
		has_row_labels: false,
		available_sheets: ['Summary', 'People'],
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: NO_FEATURES,
	});

	beforeEach(() => {
		// The instance reads PositronReactServices.services in its constructor;
		// bridge the builder-configured container to the singleton.
		PositronReactServices.services = ctx.reactServices;

		backendState = makeBackendState();
		setDatasetImportOptions = createSetImportOptionsStub();

		const backendClient = stubInterface<PositronDataExplorerDuckDBBackend>({
			clientId: 'duckdb:file:///book.xlsx',
			setDatasetImportOptions,
		});

		const mockClient: Partial<DataExplorerClientInstance> = {
			backendClient,
			get cachedBackendState() { return backendState; },
			onDidClose: new Emitter<void>().event,
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: new Emitter<BackendState>().event,
			getBackendState: vi.fn().mockResolvedValue(backendState),
			getSupportedFeatures: vi.fn().mockReturnValue(backendState.supported_features),
			dispose: vi.fn(),
		};

		instance = new PositronDataExplorerInstance('R', mockClient as DataExplorerClientInstance);
		disposables = new DisposableStore();
	});

	afterEach(() => {
		disposables.dispose();
		instance.dispose();
	});

	afterAll(() => {
		PositronReactServices.services = undefined!;
	});

	it('exposes available sheets and defaults the selected sheet to the first', () => {
		expect(instance.fileAvailableSheets).toEqual(['Summary', 'People']);
		expect(instance.fileSelectedSheet).toBe('Summary');
	});

	it('applyFileOptions sends both options and updates state, firing the header event only on change', async () => {
		const headerChanges: boolean[] = [];
		disposables.add(instance.onDidChangeFileHasHeaderRow(value => headerChanges.push(value)));

		await instance.applyFileOptions({ hasHeaderRow: false, sheetName: 'People' });

		expect(setDatasetImportOptions).toHaveBeenCalledWith({ has_header_row: false, sheet_name: 'People' });
		expect(instance.fileHasHeaderRow).toBe(false);
		expect(instance.fileSelectedSheet).toBe('People');
		expect(headerChanges).toEqual([false]);
	});

	it('does not fire the header event when only the sheet changes', async () => {
		const headerChanges: boolean[] = [];
		disposables.add(instance.onDidChangeFileHasHeaderRow(value => headerChanges.push(value)));

		await instance.applyFileOptions({ hasHeaderRow: true, sheetName: 'People' });

		expect(instance.fileSelectedSheet).toBe('People');
		expect(headerChanges).toEqual([]);
	});

	it('leaves state unchanged and notifies on failure', async () => {
		const errorSpy = vi.spyOn(ctx.reactServices.notificationService, 'error');
		setDatasetImportOptions.mockResolvedValue({ error_message: 'Sheet "People" not found' });

		await instance.applyFileOptions({ hasHeaderRow: false, sheetName: 'People' });

		expect(errorSpy).toHaveBeenCalled();
		// State must not advance when the backend rejected the options.
		expect(instance.fileHasHeaderRow).toBe(true);
		expect(instance.fileSelectedSheet).toBe('Summary');
	});

	it('toggleFileHasHeaderRow flips the header while preserving the selected sheet', async () => {
		await instance.applyFileOptions({ hasHeaderRow: true, sheetName: 'People' });
		setDatasetImportOptions.mockClear();

		await instance.toggleFileHasHeaderRow();

		expect(setDatasetImportOptions).toHaveBeenCalledWith({ has_header_row: false, sheet_name: 'People' });
		expect(instance.fileHasHeaderRow).toBe(false);
	});
});
