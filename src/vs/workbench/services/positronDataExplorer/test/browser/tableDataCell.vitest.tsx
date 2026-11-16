/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ColumnDisplayType } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableDataCell } from '../../browser/components/tableDataCell.js';
import { PositronDataExplorerColumn } from '../../browser/positronDataExplorerColumn.js';
import { parseSearchTerm } from '../../common/dataExplorerSearch.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { DataCellKind } from '../../common/tableDataCache.js';

describe('TableDataCell', () => {
	const rtl = setupRTLRenderer();
	const column = new PositronDataExplorerColumn(getColumnSchema('s', 0, 'str', ColumnDisplayType.String));

	function renderCell(formatted: string, term?: string, searchMatched?: boolean) {
		rtl.render(
			<TableDataCell
				column={column}
				dataCell={{ formatted, kind: DataCellKind.NON_NULL }}
				search={term === undefined ? undefined : parseSearchTerm(term)}
				searchMatched={searchMatched}
			/>
		);
	}

	it('highlights the first occurrence of the term in a matched cell', () => {
		renderCell('xABCxabc', 'abc', true);
		expect(screen.getByText('ABC', { selector: 'mark' })).toBeInTheDocument();
		expect(screen.getAllByText(/abc/i, { selector: 'mark' })).toHaveLength(1);
	});

	it('highlights a match that spans an escaped newline and trailing whitespace', () => {
		renderCell('a\nb ', 'a\\nb ', true);
		expect(screen.getByText('a\\nb', { selector: 'mark' })).toBeInTheDocument();
		expect(screen.getByText('\u00B7', { selector: 'mark > .whitespace' })).toBeInTheDocument();
	});

	it('marks the cell but highlights no text when the match is not in the display', () => {
		renderCell('3.14', '3.141', true);
		expect(screen.getByText('3.14').closest('.text-container')).toHaveClass('search-match');
		expect(screen.queryByText(/./, { selector: 'mark' })).not.toBeInTheDocument();
	});

	it('highlights nothing in a cell that did not match', () => {
		renderCell('abc', 'abc', false);
		expect(screen.getByText('abc').closest('.text-container')).not.toHaveClass('search-match');
		expect(screen.queryByText('abc', { selector: 'mark' })).not.toBeInTheDocument();
	});
});
