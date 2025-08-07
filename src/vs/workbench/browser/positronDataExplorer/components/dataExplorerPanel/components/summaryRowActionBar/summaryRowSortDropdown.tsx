/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryRowSortDropdown.css';

import React from 'react';

import { ActionBarMenuButton } from '../../../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { localize } from '../../../../../../../nls.js';
import { SearchSchemaSortOrder } from '../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
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
		id: SearchSchemaSortOrder.Original,
		label: positronSortByOriginal,
		option: SearchSchemaSortOrder.Original
	},
	{
		id: SearchSchemaSortOrder.AscendingName,
		label: positronSortByNameAsc,
		option: SearchSchemaSortOrder.AscendingName
	},
	{
		id: SearchSchemaSortOrder.DescendingName,
		label: positronSortByNameDesc,
		option: SearchSchemaSortOrder.DescendingName
	},
	{
		id: SearchSchemaSortOrder.AscendingType,
		label: positronSortByTypeAsc,
		option: SearchSchemaSortOrder.AscendingType
	},
	{
		id: SearchSchemaSortOrder.DescendingType,
		label: positronSortByTypeDesc,
		option: SearchSchemaSortOrder.DescendingType
	},
];

// create a map of sort id to sort label for the dropdown
const sortLabelMap = new Map(
	sortOptions.map(option => [option.id, option.label])
);

/**
 * SummaryRowSortDropdownProps interface.
 */
export interface SummaryRowSortDropdownProps {
	currentSort: SearchSchemaSortOrder;
	onSortChanged: (sortOption: SearchSchemaSortOrder) => void;
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
