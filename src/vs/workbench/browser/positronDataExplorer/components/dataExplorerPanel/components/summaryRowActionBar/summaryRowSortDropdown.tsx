/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

import './summaryRowSortDropdown.css';
import { ActionBarMenuButton } from '../../../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { localize } from '../../../../../../../nls.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
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

/**
 * SummaryRowSortDropdownProps interface.
 */
export interface SummaryRowSortDropdownProps {
	currentSort: SummaryRowSortOption;
	onSortChanged: (sortOption: SummaryRowSortOption) => void;
}

export const SummaryRowSortDropdown = ({ currentSort, onSortChanged }: SummaryRowSortDropdownProps) => {
	// Builds the actions.
	const actions = () => {
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
			icon={ThemeIcon.fromId('positron-variables-sorting')} // TODO: replace
			label={currentSort}
			tooltip={positronDataExplorerSummarySort}
		/>
	);
}
