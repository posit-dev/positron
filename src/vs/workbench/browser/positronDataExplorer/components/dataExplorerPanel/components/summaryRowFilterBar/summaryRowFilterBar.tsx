/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryRowFilterBar.css';

import React, { useState } from 'react';

import { SummaryRowSortDropdown } from './summaryRowSortDropdown.js';
import { SummaryRowFilterInput } from './summaryRowFilterInput.js';
import { TableSummaryDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/tableSummaryDataGridInstance.js';

export interface SummaryRowFilterBarProps {
	instance: TableSummaryDataGridInstance
}

export const SummaryRowFilterBar = ({ instance }: SummaryRowFilterBarProps) => {
	const [summarySearchText, setSummarySearchText] = useState('');

	/**
	 * Handler for when the summary search text changes.
	 * @param searchText The new search text.
	 */
	const handleSummarySearchTextChanged = async (searchText: string) => {
		setSummarySearchText(searchText);

		// Only update the search text if it has changed
		if (searchText !== summarySearchText) {
			// Apply the column name search filter
			await instance.setSearchText(searchText);
		}
	};

	return (
		<div className='summary-row-filter-bar'>
			<SummaryRowSortDropdown />
			<SummaryRowFilterInput
				searchText={summarySearchText}
				onSearchTextChanged={handleSummarySearchTextChanged}
			/>
		</div>
	);
}
