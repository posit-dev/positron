/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */

import sinon from 'sinon';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnSummaryCell } from '../../browser/components/columnSummaryCell.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { ColumnDisplayType, SupportStatus, ColumnProfileType, SupportedFeatures } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * Creates a minimal mock of TableSummaryDataGridInstance.
 */
function createMockInstance(overrides: Partial<TableSummaryDataGridInstance> = {}): TableSummaryDataGridInstance {
	const mockHoverManager: Partial<PositronActionBarHoverManager> = {
		showHover: sinon.stub(),
		hideHover: sinon.stub()
	};

	const mockSupportedFeatures: SupportedFeatures = {
		get_column_profiles: {
			support_status: SupportStatus.Supported,
			supported_types: [
				{ profile_type: ColumnProfileType.NullCount, support_status: SupportStatus.Supported }
			]
		},
		search_schema: { support_status: SupportStatus.Supported, supported_types: [] },
		set_column_filters: { support_status: SupportStatus.Supported, supported_types: [] },
		set_row_filters: { support_status: SupportStatus.Supported, supported_types: [], supports_conditions: SupportStatus.Supported },
		set_sort_columns: { support_status: SupportStatus.Supported },
		export_data_selection: { support_status: SupportStatus.Supported, supported_formats: [] },
		convert_to_code: { support_status: SupportStatus.Supported }
	};

	return {
		cursorRowIndex: 0,
		focused: false,
		getSupportedFeatures: () => mockSupportedFeatures,
		getColumnProfileNullPercent: () => undefined,
		getColumnProfileNullCount: () => undefined,
		getColumnProfileSmallHistogram: () => undefined,
		getColumnProfileSmallFrequencyTable: () => undefined,
		isColumnExpanded: () => false,
		canToggleColumnExpansion: () => true,
		isSummaryStatsSupported: () => true,
		scrollToRow: async () => { },
		setCursorRow: () => { },
		toggleExpandColumn: async () => { },
		getColumnProfileLargeHistogram: () => undefined,
		getColumnProfileLargeFrequencyTable: () => undefined,
		getColumnProfileSummaryStats: () => undefined,
		hoverManager: mockHoverManager as PositronActionBarHoverManager,
		configurationService: {} as IConfigurationService,
		...overrides
	} as TableSummaryDataGridInstance;
}

describe('ColumnSummaryCell - Snapshot & RTL', () => {
	// Use the builder at the bare tier -- this component does not need DI services.
	// The builder still provides disposable tracking and fresh-per-test lifecycle.
	const ctx = createTestContainer().build();

	afterEach(() => {
		cleanup();
		sinon.restore();
	});

	// --- Snapshot tests -----------------------------------------------------------

	describe('snapshots', () => {
		it('matches snapshot for a string column with no profile data', () => {
			const schema = getColumnSchema('user_name', 0, 'string', ColumnDisplayType.String);
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.innerHTML).toMatchSnapshot();
		});

		it('matches snapshot for a numeric column with no profile data', () => {
			const schema = getColumnSchema('price', 1, 'float64', ColumnDisplayType.Floating);
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={1}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.innerHTML).toMatchSnapshot();
		});

		it('matches snapshot for a boolean column with 50% nulls', () => {
			const schema = getColumnSchema('is_active', 2, 'boolean', ColumnDisplayType.Boolean);
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 50,
				getColumnProfileNullCount: () => 500,
			});

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={2}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.innerHTML).toMatchSnapshot();
		});

		it('matches snapshot for a date column with 0% nulls', () => {
			const schema = getColumnSchema('created_at', 3, 'date', ColumnDisplayType.Date);
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 0,
				getColumnProfileNullCount: () => 0,
			});

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={3}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.innerHTML).toMatchSnapshot();
		});

		it('matches snapshot for 100% null column', () => {
			const schema = getColumnSchema('empty_col', 4, 'string', ColumnDisplayType.String);
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 100,
				getColumnProfileNullCount: () => 1000,
			});

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={4}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.innerHTML).toMatchSnapshot();
		});
	});

	// --- React Testing Library tests -----------------------------------------------

	describe('RTL: null percent display', () => {
		const schema = getColumnSchema('test_col', 0, 'string', ColumnDisplayType.String);

		it('displays 0% for zero nulls', () => {
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 0,
				getColumnProfileNullCount: () => 0,
			});

			render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(screen.getByText('0%')).toBeTruthy();
		});

		it('displays <1% for sub-1% nulls', () => {
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 0.5,
				getColumnProfileNullCount: () => 1,
			});

			render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(screen.getByText('<1%')).toBeTruthy();
		});

		it('displays 100% when all values are null', () => {
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 100,
				getColumnProfileNullCount: () => 1000,
			});

			render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(screen.getByText('100%')).toBeTruthy();
		});

		it('floors the displayed percentage (99.9% shows as 99%)', () => {
			const instance = createMockInstance({
				getColumnProfileNullPercent: () => 99.9,
				getColumnProfileNullCount: () => 999,
			});

			render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(screen.getByText('99%')).toBeTruthy();
		});
	});

	describe('RTL: column name and type icon', () => {
		it('renders the column name', () => {
			const schema = getColumnSchema('revenue', 0, 'float64', ColumnDisplayType.Floating);
			const instance = createMockInstance();

			render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(screen.getByText('revenue')).toBeTruthy();
		});

		it('renders the number type icon for a float column', () => {
			const schema = getColumnSchema('price', 0, 'float64', ColumnDisplayType.Floating);
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.querySelector('.codicon-positron-data-type-number')).toBeTruthy();
		});

		it('renders the string type icon for a string column', () => {
			const schema = getColumnSchema('name', 0, 'string', ColumnDisplayType.String);
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.querySelector('.codicon-positron-data-type-string')).toBeTruthy();
		});

		it('renders the boolean type icon for a boolean column', () => {
			const schema = getColumnSchema('is_active', 0, 'boolean', ColumnDisplayType.Boolean);
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.querySelector('.codicon-positron-data-type-boolean')).toBeTruthy();
		});
	});

	describe('RTL: expand/collapse', () => {
		it('renders the chevron-right icon when collapsed', () => {
			const schema = getColumnSchema('col', 0, 'string', ColumnDisplayType.String);
			const instance = createMockInstance({ isColumnExpanded: () => false });

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.querySelector('.codicon-chevron-right')).toBeTruthy();
			expect(container.querySelector('.codicon-chevron-down')).toBeNull();
		});

		it('renders the chevron-down icon when expanded', () => {
			const schema = getColumnSchema('col', 0, 'string', ColumnDisplayType.String);
			const instance = createMockInstance({ isColumnExpanded: () => true });

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			expect(container.querySelector('.codicon-chevron-down')).toBeTruthy();
			expect(container.querySelector('.codicon-chevron-right')).toBeNull();
		});
	});

	describe('RTL: interactions', () => {
		it('calls scrollToRow and setCursorRow on mousedown', async () => {
			const schema = getColumnSchema('col', 0, 'string', ColumnDisplayType.String);
			const scrollToRow = sinon.stub().resolves();
			const setCursorRow = sinon.stub();
			const instance = createMockInstance({ scrollToRow, setCursorRow });

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={() => { }}
				/>
			);

			const summary = container.querySelector('.column-summary')!;
			const mouseDown = new MouseEvent('mousedown', { bubbles: true });
			summary.dispatchEvent(mouseDown);

			expect(scrollToRow.calledOnce).toBe(true);
			expect(scrollToRow.calledWith(0)).toBe(true);
			expect(setCursorRow.calledOnce).toBe(true);
			expect(setCursorRow.calledWith(0)).toBe(true);
		});

		it('calls onDoubleClick when double-clicked', async () => {
			const user = userEvent.setup();
			const schema = getColumnSchema('col', 0, 'string', ColumnDisplayType.String);
			const onDoubleClick = sinon.stub();
			const instance = createMockInstance();

			const { container } = render(
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={schema}
					instance={instance}
					onDoubleClick={onDoubleClick}
				/>
			);

			const summary = container.querySelector('.column-summary')!;
			await user.dblClick(summary);

			expect(onDoubleClick.called).toBe(true);
		});
	});
});
