/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { BackendState, ColumnDisplayType, FilterComparisonOp, RowFilter, RowFilterCondition, RowFilterType, SupportStatus } from '../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { DataExplorerClientInstance, DataExplorerClientStatus } from '../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { StatusBar } from '../../components/dataExplorerPanel/components/statusBar.js';
import { PositronDataExplorerContextProvider } from '../../positronDataExplorerContext.js';

const FILTER: RowFilter = {
	filter_id: 'f',
	filter_type: RowFilterType.Compare,
	column_schema: { column_name: 'n', column_index: 0, type_name: 'integer', type_display: ColumnDisplayType.Integer },
	condition: RowFilterCondition.And,
	params: { op: FilterComparisonOp.Gt, value: '0' },
};

/** A backend state with the given row counts, as a driver reports it from getState. */
function backendState(rows: number, unfilteredRows: number, extra: Partial<BackendState> = {}): BackendState {
	return {
		display_name: 'x',
		table_shape: { num_rows: rows, num_columns: 3 },
		table_unfiltered_shape: { num_rows: unfilteredRows, num_columns: 3 },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: {
			search_schema: { support_status: SupportStatus.Supported, supported_types: [] },
			set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
			set_row_filters: { support_status: SupportStatus.Supported, supports_conditions: SupportStatus.Unsupported, supported_types: [] },
			get_column_profiles: { support_status: SupportStatus.Supported, supported_types: [] },
			export_data_selection: { support_status: SupportStatus.Supported, supported_formats: [] },
			set_sort_columns: { support_status: SupportStatus.Supported },
			convert_to_code: { support_status: SupportStatus.Supported },
		},
		...extra,
	};
}

describe('StatusBar', () => {
	const rtl = setupRTLRenderer();

	/** Renders the status bar over a client reporting the given state, and returns the bar. */
	function renderStatusBar(state: BackendState) {
		const client = stubInterface<DataExplorerClientInstance>({
			cachedBackendState: state,
			onDidUpdateBackendState: Event.None,
			status: DataExplorerClientStatus.Idle,
			onDidStatusUpdate: Event.None,
		});
		const instance = stubInterface<IPositronDataExplorerInstance>({ dataExplorerClientInstance: client });
		rtl.render(
			<PositronDataExplorerContextProvider instance={instance}>
				<StatusBar />
			</PositronDataExplorerContextProvider>
		);
		return screen.getByTestId('status-bar');
	}

	it('shows the row count of a backend that serves every row', () => {
		const statusBar = renderStatusBar(backendState(1234, 1234));
		expect(statusBar).toHaveTextContent(/^1,234 rows 3 columns$/);
		expect(statusBar).not.toHaveAttribute('title');
	});

	it('shows the row count of a backend that sends the total as null', () => {
		// The Python backend serializes an unset optional field as null rather than leaving it out.
		const statusBar = renderStatusBar(backendState(1234, 1234, { total_num_rows: null as unknown as undefined }));
		expect(statusBar).toHaveTextContent(/^1,234 rows 3 columns$/);
	});

	it('shows the window and the total of a backend that serves only the leading rows', () => {
		const statusBar = renderStatusBar(backendState(50000, 2000000, { total_num_rows: 2000000 }));
		expect(statusBar).toHaveTextContent(/^First 50,000 of 2,000,000 rows 3 columns$/);
		expect(statusBar).toHaveAttribute('title', 'Only the first 50,000 rows are shown. Sort or filter to see other rows.');
	});

	it('measures a filtered window against the matching rows, not the rows shown', () => {
		const statusBar = renderStatusBar(backendState(50000, 2000000, { total_num_rows: 500000, row_filters: [FILTER] }));
		expect(statusBar).toHaveTextContent(/^First 50,000 of 500,000 matching rows \(25\.00% of 2,000,000 total\) 3 columns$/);
	});
});
