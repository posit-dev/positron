/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './searchAllColumns.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../../nls.js';
import { Delayer } from '../../../../../../../../base/common/async.js';
import { isMacintosh } from '../../../../../../../../base/common/platform.js';
import { DisposableStore } from '../../../../../../../../base/common/lifecycle.js';
import { usePositronDataExplorerContext } from '../../../../../positronDataExplorerContext.js';
import { splitRowFilters } from '../../../../../../../services/positronDataExplorer/common/dataExplorerSearch.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';

/**
 * The delay after typing stops before the search runs.
 */
const SEARCH_DELAY = 300;

/**
 * SearchAllColumns component. A search box that filters the table to the rows where any column
 * matches the search term.
 * @returns The rendered component.
 */
export const SearchAllColumns = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();
	const clientInstance = context.instance.dataExplorerClientInstance;
	const gridInstance = context.instance.tableDataDataGridInstance;

	// Reference hooks.
	const filterRef = useRef<ActionBarFilterHandle>(null);
	const warningRef = useRef<HTMLDivElement>(null);
	const delayerRef = useRef<Delayer<void>>(undefined);
	const textRef = useRef(gridInstance.searchTerm);

	// State hooks.
	const [backendState, setBackendState] = useState(() => clientInstance.cachedBackendState);

	// Main useEffect.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		delayerRef.current = disposableStore.add(new Delayer<void>(SEARCH_DELAY));

		disposableStore.add(clientInstance.onDidUpdateBackendState(setBackendState));

		disposableStore.add(gridInstance.onDidRequestSearchFocus(() => {
			filterRef.current?.focus();
			filterRef.current?.select();
		}));

		// Show search terms set elsewhere, e.g. cleared from the no results view.
		disposableStore.add(gridInstance.onDidChangeSearchTerm(term => {
			if (term !== textRef.current) {
				filterRef.current?.setFilterText(term);
			}
		}));

		return () => disposableStore.dispose();
	}, [clientInstance, gridInstance]);

	/**
	 * Applies the search text now.
	 */
	const applySearch = () => {
		delayerRef.current?.cancel();
		if (textRef.current !== gridInstance.searchTerm) {
			gridInstance.setSearchTerm(textRef.current);
		}
	};

	/**
	 * Search text changed handler. Clearing applies immediately; typing applies after a delay.
	 * @param text The search text.
	 */
	const searchTextChangedHandler = (text: string) => {
		textRef.current = text;
		if (text === '' || text === gridInstance.searchTerm) {
			applySearch();
		} else {
			delayerRef.current?.trigger(async () => applySearch());
		}
	};

	/**
	 * Key down handler. The input clears itself on Escape when it has text; Escape on an empty
	 * input returns focus to the grid.
	 * @param e The keyboard event.
	 */
	const keyDownHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			applySearch();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			gridInstance.requestFocus();
		}
	};

	// Describe the applied search.
	const searchFilter = splitRowFilters(backendState?.row_filters ?? []).globalSearch;
	const announcement = searchFilter && backendState ? localize(
		'positron.dataExplorer.search.announcement',
		"{0} of {1} rows match",
		backendState.table_shape.num_rows.toLocaleString(),
		backendState.table_unfiltered_shape.num_rows.toLocaleString()
	) : '';

	// Render.
	return (
		<div className='search-all-columns'>
			{searchFilter?.is_valid === false &&
				<div
					ref={warningRef}
					aria-label={searchFilter.error_message}
					className='codicon codicon-warning search-error'
					role='img'
					onMouseEnter={() => warningRef.current && gridInstance.hoverManager.showHover(warningRef.current, searchFilter.error_message)}
					onMouseLeave={() => gridInstance.hoverManager.hideHover()}
				/>
			}
			<ActionBarFilter
				ref={filterRef}
				ariaLabel={localize('positron.dataExplorer.search.ariaLabel', "Search all columns ({0})", isMacintosh ? 'Cmd+F' : 'Ctrl+F')}
				clearButtonAriaLabel={localize('positron.dataExplorer.search.clear', "Clear search")}
				initialFilterText={gridInstance.searchTerm}
				placeholder={localize('positron.dataExplorer.search.placeholder', "Search all columns")}
				width={220}
				onFilterTextChanged={searchTextChangedHandler}
				onKeyDown={keyDownHandler}
			/>
			<div aria-live='polite' className='search-announcement' role='status'>{announcement}</div>
		</div>
	);
};
