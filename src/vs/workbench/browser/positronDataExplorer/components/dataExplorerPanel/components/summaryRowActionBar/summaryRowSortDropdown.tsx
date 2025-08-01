/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryRowSortDropdown.css';

import React from 'react';

import { ActionBarMenuButton } from '../../../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { localize } from '../../../../../../../nls.js';
import { SummaryRowSortOption } from '../../../../../../services/positronDataExplorer/common/tableSummaryCache.js';

/**
 * Localized strings.
 */
const positronDataExplorerSummarySort = localize('positron.dataExplorer.sort', "Sort summary row data");
const positronSortByOriginal = localize('positron.dataExplorer.sortByOriginal', "Sort by Original");
const positronSortByNameAsc = localize('positron.dataExplorer.sortByNameAsc', "Sort by Name, Ascending");
const positronSortByNameDesc = localize('positron.dataExplorer.sortByNameDesc', "Sort by Name, Descending");
const positronSortByTypeAsc = localize('positron.dataExplorer.sortByTypeAsc', "Sort by Type, Ascending");
const positronSortByTypeDesc = localize('positron.dataExplorer.sortByTypeDesc', "Sort by Type, Descending");

const sortOptions = [
	{
		id: SummaryRowSortOption.Original,
		label: positronSortByOriginal,
		option: SummaryRowSortOption.Original
	},
	{
		id: SummaryRowSortOption.NameAscending,
		label: positronSortByNameAsc,
		option: SummaryRowSortOption.NameAscending
	},
	{
		id: SummaryRowSortOption.NameDescending,
		label: positronSortByNameDesc,
		option: SummaryRowSortOption.NameDescending
	},
	{
		id: SummaryRowSortOption.TypeAscending,
		label: positronSortByTypeAsc,
		option: SummaryRowSortOption.TypeAscending
	},
	{
		id: SummaryRowSortOption.TypeDescending,
		label: positronSortByTypeDesc,
		option: SummaryRowSortOption.TypeDescending
	}
];

// create a map of sort id to sort label for the dropdown
const sortLabelMap = new Map(
	sortOptions.map(option => [option.id, option.label])
);

/**
 * SummaryRowSortDropdownProps interface.
 */
export interface SummaryRowSortDropdownProps {
	currentSort: SummaryRowSortOption; // TODO: replace with backend supported option or map to backend supported options
	onSortChanged: (sortOption: SummaryRowSortOption) => void;
}

export const SummaryRowSortDropdown = ({ currentSort, onSortChanged }: SummaryRowSortDropdownProps) => {
	// Get the label for the current sort option
	const currentSortLabel = sortLabelMap.get(currentSort) || positronSortByOriginal;

	// Builds the actions.
	const actions = () => {
		return sortOptions.map(sortOption => ({
			class: undefined,
			id: sortOption.id,
			label: sortOption.label,
			tooltip: sortOption.label,
			enabled: true,
			checked: currentSort === sortOption.option,
			run: () => { onSortChanged(sortOption.option) }
		}));
	};

	return (
		<ActionBarMenuButton
			actions={actions}
			ariaLabel={positronDataExplorerSummarySort}
			label={currentSortLabel}
			tooltip={positronDataExplorerSummarySort}
		/>
	);
}
