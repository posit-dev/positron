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
import { SearchSchemaSortOrder } from '../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';

// This is the debounce time for the search input in milliseconds.
// It allows the user to type without triggering a search on every keystroke.
const SEARCH_DEBOUNCE_TIMEOUT = 500;

export interface SummaryRowActionBarProps {
	instance: TableSummaryDataGridInstance
}

export const SummaryRowActionBar = ({ instance }: SummaryRowActionBarProps) => {
	const filterRef = useRef<ActionBarFilterHandle>(null);
	// State to hold the search text typed by the user
	const [searchText, setSearchText] = useState(instance.searchText || '');
	// State to hold the debounced search text that we use to filter data.
	const [debouncedSearchText, setDebouncedSearchText] = useState(instance.searchText || '');
	// State to hold the current sort option
	const [sortOption, setSortOption] = useState<SearchSchemaSortOrder>(instance.sortOption || SearchSchemaSortOrder.Original);

	/**
	 * Initialize the search text input and sort option when the instance changes.
	 * This ensures the search text and sort option are displayed correctly when switching between tabs.
	 */
	useEffect(() => {
		const instanceSearchText = instance.searchText || '';
		const instanceSortOption = instance.sortOption || SearchSchemaSortOrder.Original;

		setSearchText(instanceSearchText);
		setDebouncedSearchText(instanceSearchText);
		setSortOption(instanceSortOption);

		// Update the filter input field
		if (filterRef.current) {
			filterRef.current.setFilterText(instanceSearchText);
		}
	}, [instance]);

	/**
	 * Update the debounced search text after a delay.
	 * This is to prevent excessive search requests while the user is typing.
	 */
	useEffect(() => {
		const debounce = setTimeout(() => {
			setDebouncedSearchText(searchText);
		}, SEARCH_DEBOUNCE_TIMEOUT);

		return () => clearTimeout(debounce);
	}, [searchText]);

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

	/**
	 * Whenever the sort option changes, we request the summary data grid instance to
	 * re-fetch the data with the new sort option.
	 */
	useEffect(() => {
		const updateSortOption = async () => {
			await instance.setSortOption(sortOption);
		};
		updateSortOption();
	}, [sortOption, instance]);

	/**
	 * Update the sort option when the user selects a new sort option from the dropdown.
	 * @param newSortOption The new sort option selected by the user.
	 */
	const handleSortChanged = (newSortOption: SearchSchemaSortOrder) => {
		setSortOption(newSortOption);
	};


	return (
		<div className='summary-row-filter-bar'>
			<PositronActionBarContextProvider>
				<PositronActionBar paddingLeft={8} paddingRight={14}>
					<ActionBarRegion location='left'>
						<SummaryRowSortDropdown
							currentSort={sortOption}
							onSortChanged={handleSortChanged}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarFilter
							ref={filterRef}
							width={140}
							onFilterTextChanged={filterText => setSearchText(filterText)} />
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
}
