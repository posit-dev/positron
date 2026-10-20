/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { ColumnProfileInteger } from '../../browser/components/columnProfileInteger.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { ColumnDisplayType, ColumnSummaryStats } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

function createInstance(minValue: string, maxValue: string): TableSummaryDataGridInstance {
	const summaryStats: ColumnSummaryStats = {
		type_display: ColumnDisplayType.Integer,
		number_stats: { min_value: minValue, max_value: maxValue },
	};
	return stubInterface<TableSummaryDataGridInstance>({
		getColumnProfileLargeHistogram: () => undefined,
		getColumnProfileSummaryStats: () => summaryStats,
		getColumnSchema: () => undefined,
		getColumnProfileNullCount: () => 0,
	});
}

describe('ColumnProfileInteger', () => {
	const rtl = setupRTLRenderer();

	it('displays exact integer strings for Min and Max beyond float precision', () => {
		rtl.render(<ColumnProfileInteger columnIndex={0} instance={createInstance('-9223372036854775808', '18446744073709551615')} />);

		expect(screen.getByText('-9223372036854775808', { selector: '.value' })).toBeInTheDocument();
		expect(screen.getByText('18446744073709551615', { selector: '.value' })).toBeInTheDocument();
	});

	it('rounds Min and Max strings that are not plain integers', () => {
		rtl.render(<ColumnProfileInteger columnIndex={0} instance={createInstance('1.5', '1.5e+07')} />);

		expect(screen.getByText('2', { selector: '.value' })).toBeInTheDocument();
		expect(screen.getByText('15000000', { selector: '.value' })).toBeInTheDocument();
	});
});
