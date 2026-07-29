/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import {
	BackendState,
	ColumnDisplayType,
	ColumnSelection,
	SchemaUpdateEvent,
	SupportStatus,
	TableData,
	TableSchema
} from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableDataDataGridInstance } from '../../browser/tableDataDataGridInstance.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { ColumnWidthCalculators, TableDataCache } from '../../common/tableDataCache.js';

/**
 * The default column width the data grid falls back to when no calculated widths are available.
 */
const DEFAULT_COLUMN_WIDTH = 200;

/**
 * The width the test column header width calculator reports.
 */
const CALCULATED_COLUMN_WIDTH = 321;

/**
 * The width a second set of column width calculators reports, standing in for the wider font a
 * change to `editor.fontFamily` or `editor.fontSize` produces.
 */
const WIDER_COLUMN_WIDTH = 456;

/**
 * The width a superseded calculation reports, which must never reach the columns.
 */
const STALE_COLUMN_WIDTH = 111;

/**
 * Builds a backend state. The instance reads the table shape, the sort keys, and the supported
 * features from it, so the rest is filler.
 */
function backendState(): BackendState {
	return {
		display_name: 'test-table',
		table_shape: { num_rows: 100, num_columns: 2 },
		table_unfiltered_shape: { num_rows: 100, num_columns: 2 },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: {
			search_schema: { support_status: SupportStatus.Supported, supported_types: [] },
			set_column_filters: { support_status: SupportStatus.Supported, supported_types: [] },
			set_row_filters: { support_status: SupportStatus.Supported, supports_conditions: SupportStatus.Supported, supported_types: [] },
			get_column_profiles: { support_status: SupportStatus.Supported, supported_types: [] },
			export_data_selection: { support_status: SupportStatus.Supported, supported_formats: [] },
			set_sort_columns: { support_status: SupportStatus.Supported },
			convert_to_code: { support_status: SupportStatus.Supported }
		}
	};
}

/**
 * Returns column width calculators that report a fixed column header width.
 * @param columnWidth The column header width to report.
 */
function columnWidthCalculators(columnWidth = CALCULATED_COLUMN_WIDTH): ColumnWidthCalculators {
	return {
		columnHeaderWidthCalculator: () => columnWidth,
		columnValueWidthCalculator: () => 50
	};
}

describe('TableDataDataGridInstance', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IHoverService, NullHoverService)
		.build();

	let cache: TableDataCache;
	let instance: TableDataDataGridInstance;
	let backendStateEmitter: Emitter<BackendState>;
	let getBackendState: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// TableDataDataGridInstance reads PositronReactServices.services (static singleton) in its
		// constructor. Bridge the builder-configured DI container to the singleton so the services
		// stubbed above flow through to the instance under test.
		PositronReactServices.services = ctx.reactServices;

		backendStateEmitter = new Emitter<BackendState>();
		getBackendState = vi.fn().mockResolvedValue(backendState());

		const client: Partial<DataExplorerClientInstance> = {
			cachedBackendState: backendState(),
			onDidClose: new Emitter<void>().event,
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: backendStateEmitter.event,
			getBackendState: getBackendState as DataExplorerClientInstance['getBackendState'],
			getSchema: vi.fn(async (indices: number[]): Promise<TableSchema> => ({
				columns: indices.map(i =>
					getColumnSchema(`col${i}`, i, 'number', ColumnDisplayType.Floating)
				)
			})),
			getDataValues: vi.fn(async (columns: ColumnSelection[]): Promise<TableData> => ({
				columns: columns.map(() => ['1'])
			})),
			getSupportedFeatures: vi.fn().mockReturnValue(backendState().supported_features),
		};

		// The real cache is used so that the column width calculators are exercised end to end.
		cache = new TableDataCache(client as DataExplorerClientInstance);
		instance = new TableDataDataGridInstance(client as DataExplorerClientInstance, cache);
	});

	afterEach(() => {
		instance.dispose();
		cache.dispose();
		backendStateEmitter.dispose();
		PositronReactServices.services = undefined!;
	});

	it('recalculates the column widths when the calculators arrive after the initial load', async () => {
		// The data explorer's React tree mounts asynchronously, so the initial load can run before
		// the column width calculators are supplied. The columns are left at the default width, and
		// without a recalculation nothing would ask for the widths again.
		await instance.setVisible(true);
		expect(instance.firstColumn?.width).toBe(DEFAULT_COLUMN_WIDTH);

		// Supplying the calculators recalculates the widths.
		instance.setColumnWidthCalculators(columnWidthCalculators());
		await vi.waitFor(() =>
			expect(instance.firstColumn?.width).toBe(CALCULATED_COLUMN_WIDTH)
		);
	});

	it('applies the calculated widths on the initial load when the calculators arrive first', async () => {
		const calculateColumnWidths = vi.spyOn(cache, 'calculateColumnWidths');

		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);

		expect(instance.firstColumn?.width).toBe(CALCULATED_COLUMN_WIDTH);

		// The initial load already calculated the widths, so the setter must not schedule redundant
		// work of its own.
		expect(calculateColumnWidths).toHaveBeenCalledTimes(1);
	});

	it('recalculates the column widths whenever the calculators are set again', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);
		expect(instance.firstColumn?.width).toBe(CALCULATED_COLUMN_WIDTH);

		// Supplying calculators means the columns are to be measured with them. An editor font change
		// rebuilds them, and they then measure column values -- and so the columns -- differently, so
		// widths calculated with the previous set no longer fit their values.
		instance.setColumnWidthCalculators(columnWidthCalculators(WIDER_COLUMN_WIDTH));

		await vi.waitFor(() => expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH));
	});

	it('recalculates the column widths when the calculators are cleared and supplied again', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);

		// Unmounting the panel clears the calculators, and mounting it again supplies a rebuilt set --
		// which measures with the editor font as it stands then, whether or not it changed in between.
		instance.setColumnWidthCalculators(undefined);
		instance.setColumnWidthCalculators(columnWidthCalculators(WIDER_COLUMN_WIDTH));

		await vi.waitFor(() => expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH));
	});

	it('ignores a column width calculation that a later one has superseded', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);

		// Two editor font changes in quick succession start two calculations. Hold the first one so
		// it resolves after the second, which is what varying backend round trip times produce.
		let resolveSuperseded!: (columnWidths: number[]) => void;
		const superseded = new Promise<number[]>(resolve => {
			resolveSuperseded = resolve;
		});
		const calculateColumnWidths = vi.spyOn(cache, 'calculateColumnWidths')
			.mockReturnValueOnce(superseded)
			.mockResolvedValueOnce([WIDER_COLUMN_WIDTH, WIDER_COLUMN_WIDTH]);

		instance.setColumnWidthCalculators(columnWidthCalculators());
		instance.setColumnWidthCalculators(columnWidthCalculators(WIDER_COLUMN_WIDTH));

		// The second calculation lands first and its widths are applied.
		await vi.waitFor(() => expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH));

		// The first now resolves. Its widths were measured with the font the user has already
		// changed away from, so they must not replace the ones the columns have.
		resolveSuperseded([STALE_COLUMN_WIDTH, STALE_COLUMN_WIDTH]);
		await vi.waitFor(() => expect(calculateColumnWidths).toHaveBeenCalledTimes(2));

		expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH);
	});

	it('ignores a column width calculation that a layout update has superseded', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);

		// A font change starts a calculation; hold it so that a layout update -- a backend state
		// change, a schema update, a filter -- applies its own widths while it is still in flight.
		let resolveSuperseded!: (columnWidths: number[]) => void;
		const superseded = new Promise<number[]>(resolve => {
			resolveSuperseded = resolve;
		});
		const calculateColumnWidths = vi.spyOn(cache, 'calculateColumnWidths')
			.mockReturnValueOnce(superseded)
			.mockResolvedValueOnce([WIDER_COLUMN_WIDTH, WIDER_COLUMN_WIDTH]);

		instance.setColumnWidthCalculators(columnWidthCalculators());
		backendStateEmitter.fire(backendState());

		await vi.waitFor(() => expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH));

		// The held calculation now resolves against layout entries that have moved on.
		resolveSuperseded([STALE_COLUMN_WIDTH, STALE_COLUMN_WIDTH]);
		await vi.waitFor(() => expect(calculateColumnWidths).toHaveBeenCalledTimes(2));

		expect(instance.firstColumn?.width).toBe(WIDER_COLUMN_WIDTH);
	});

	it('does not update the layout twice when a backend state event arrives during the initial load', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());
		const calculateColumnWidths = vi.spyOn(cache, 'calculateColumnWidths');

		// The backend state arrives while the initial load is awaiting it. Both the initial load and
		// the backend state handler update the layout entries, and each one calculates the column
		// widths -- a schema and a data round trip per page of columns. Only one is needed.
		getBackendState.mockImplementationOnce(async () => {
			const state = backendState();
			backendStateEmitter.fire(state);
			return state;
		});

		await instance.setVisible(true);

		expect(calculateColumnWidths).toHaveBeenCalledTimes(1);
		expect(instance.firstColumn?.width).toBe(CALCULATED_COLUMN_WIDTH);
	});

	it('retries the initial load after it fails', async () => {
		instance.setColumnWidthCalculators(columnWidthCalculators());

		// A failure partway through the initial load leaves the grid without its data, and the
		// deferred-update path has nothing pending to act on, so becoming visible again has to run
		// the load rather than treat it as done.
		getBackendState.mockRejectedValueOnce(new Error('backend went away'));
		await expect(instance.setVisible(true)).rejects.toThrow('backend went away');

		const update = vi.spyOn(cache, 'update');
		await instance.setVisible(true);

		expect(update).toHaveBeenCalled();
		expect(instance.firstColumn?.width).toBe(CALCULATED_COLUMN_WIDTH);
	});

	it('leaves the column widths alone when none can be calculated', async () => {
		// A table with too many columns to auto-size returns no widths. The columns keep the widths
		// they have -- the default ones on a first load -- rather than being reset to nothing.
		vi.spyOn(cache, 'calculateColumnWidths').mockResolvedValue(undefined);

		instance.setColumnWidthCalculators(columnWidthCalculators());
		await instance.setVisible(true);

		expect(instance.firstColumn?.width).toBe(DEFAULT_COLUMN_WIDTH);
	});
});
