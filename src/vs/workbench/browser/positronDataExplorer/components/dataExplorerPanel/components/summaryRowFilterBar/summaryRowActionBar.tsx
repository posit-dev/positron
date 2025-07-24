/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryRowActionBar.css';

import React, { useEffect, useRef, useState } from 'react';

import { SummaryRowSortDropdown } from './summaryRowSortDropdown.js';
import { TableSummaryDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/tableSummaryDataGridInstance.js';
import { PositronActionBar } from '../../../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarRegion } from '../../../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';

// This is the debounce time for the search input in milliseconds.
// It allows the user to type without triggering a search on every keystroke.
const SEARCH_DEBOUNCE_TIMEOUT = 500;

export interface SummaryRowActionBarProps {
	instance: TableSummaryDataGridInstance
}

export const SummaryRowActionBar = ({ instance }: SummaryRowActionBarProps) => {
	const filterRef = useRef<ActionBarFilterHandle>(null);
	// State to hold the search text typed by the user
	const [searchText, setSearchText] = useState('');
	// State to hold the debounced search text that we use to filter data.
	const [debouncedSearchText, setDebouncedSearchText] = useState('');

	/**
	 * Update the debounced search text after a delay.
	 * This is to prevent excessive search requests while the user is typing.
	 */
	useEffect(() => {
		const debounce = setTimeout(() => {
			setDebouncedSearchText(searchText);
		}, SEARCH_DEBOUNCE_TIMEOUT);

		return () => clearTimeout(debounce);
	}, [searchText, instance]);

	/**
	 * Every time the debounced search text changes (every SEARCH_DEBOUNCE_TIMEOUT milliseconds),
	 * we request the summary data grid instance to filter its data.
	 */
	useEffect(() => {
		const search = async () => {
			await instance.setSearchText(debouncedSearchText);
		};
		search();
	}, [debouncedSearchText, instance]);


	return (
		<PositronActionBarContextProvider>
			<PositronActionBar>
				<ActionBarRegion location='left'>
					<SummaryRowSortDropdown />
				</ActionBarRegion>
				<ActionBarRegion location='right'>
					<ActionBarFilter
						ref={filterRef}
						width={150}
						onFilterTextChanged={filterText => setSearchText(filterText)} />
				</ActionBarRegion>
			</PositronActionBar>
		</PositronActionBarContextProvider>

	);
}
