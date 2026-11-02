/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './statusBar.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { StatusBarActivityIndicator } from './statusBarActivityIndicator.js';
import { BackendState } from '../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { getGlobalSearchTerm, splitRowFilters } from '../../../../../services/positronDataExplorer/common/dataExplorerSearch.js';
import { DATA_EXPLORER_SEARCH_MAX_CELLS_KEY } from '../../../../../services/positronDataExplorer/browser/positronDataExplorerSummary.js';

/**
 * The number of characters of the search term the status bar shows.
 */
const MAX_SEARCH_TERM_LENGTH = 24;

/**
 * Renders a localized message whose {0}-style placeholders are numbers, styling the numbers as
 * counters and the words as labels, as the rest of the status bar does.
 * @param message The localized message, with its placeholders left in place.
 * @param counts The formatted numbers, by placeholder index.
 * @returns The rendered spans.
 */
const renderCountedMessage = (message: string, counts: string[]) =>
	message.split(/(\{\d+\})/).filter(part => part.length > 0).map((part, i) => {
		const placeholder = /^\{(?<index>\d+)\}$/.exec(part);
		return placeholder?.groups ?
			<span key={i} className='counter'>{counts[Number(placeholder.groups.index)]}</span> :
			// Non-breaking spaces, because the status bar's flex layout drops a span's edge spaces.
			<span key={i} className='label'>{part.replace(/ /g, '\u00a0')}</span>;
	});

/**
 * SearchStatus component. Describes the active search across all columns, with a button that
 * clears it and, when the backend searched only the leading rows, one that searches every row.
 * @param props The backend state.
 * @returns The rendered component, or nothing when no search is active.
 */
const SearchStatus = ({ backendState }: { backendState: BackendState }) => {
	const context = usePositronDataExplorerContext();
	const term = getGlobalSearchTerm(splitRowFilters(backendState.row_filters).globalSearch);
	if (term === '') {
		return null;
	}
	const gridInstance = context.instance.tableDataDataGridInstance;
	const rowsScanned = backendState.global_search_rows_scanned;
	const displayTerm = term.length > MAX_SEARCH_TERM_LENGTH ? `${term.slice(0, MAX_SEARCH_TERM_LENGTH)}\u2026` : term;

	return (
		<>
			<span>&nbsp;&nbsp;</span>
			<span className='codicon codicon-search' />
			<span className='label'>&nbsp;&quot;{displayTerm}&quot;</span>
			<Button
				ariaLabel={localize('positron.dataExplorer.statusBar.clearSearch', "Clear search")}
				className='status-bar-button'
				hoverManager={gridInstance.hoverManager}
				tooltip={localize('positron.dataExplorer.statusBar.clearSearch', "Clear search")}
				onPressed={() => gridInstance.setSearchTerm('')}
			>
				<span className='codicon codicon-close' />
			</Button>
			{typeof rowsScanned === 'number' && <>
				<Button
					ariaLabel={localize(
						'positron.dataExplorer.statusBar.searchTruncated',
						"Searched the first {0} rows only (limit set by {1})",
						rowsScanned.toLocaleString(),
						DATA_EXPLORER_SEARCH_MAX_CELLS_KEY
					)}
					className='status-bar-button'
					hoverManager={gridInstance.hoverManager}
					tooltip={localize(
						'positron.dataExplorer.statusBar.searchTruncated',
						"Searched the first {0} rows only (limit set by {1})",
						rowsScanned.toLocaleString(),
						DATA_EXPLORER_SEARCH_MAX_CELLS_KEY
					)}
					onPressed={() => gridInstance.setSearchTerm(term, 0)}
				>
					<span className='codicon codicon-warning' />
					<span className='label'>&nbsp;{localize('positron.dataExplorer.statusBar.searchAllRows', "Search All Rows")}</span>
				</Button>
			</>}
		</>
	);
};

/**
 * StatusBar component.
 * @returns The rendered component.
 */
export const StatusBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// State hooks.
	const [backendState, setBackendState] = useState(
		context.instance.dataExplorerClientInstance.cachedBackendState
	);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidUpdateBackendState event handler.
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidUpdateBackendState(
			state => setBackendState(state)
		));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.instance.dataExplorerClientInstance]);

	// Set the number of rows and number of columns.
	let numRows;
	let numColumns;
	if (!backendState) {
		numRows = 0;
		numColumns = 0;
	} else {
		numRows = backendState.table_shape.num_rows;
		numColumns = backendState?.table_shape.num_columns;
	}

	// Render a backend that serves only the leading rows of a larger result. The Python backend sends
	// an unset optional field as null rather than leaving it out.
	const totalNumRows = backendState?.total_num_rows;
	if (backendState && typeof totalNumRows === 'number') {
		const tooltip = localize(
			'positron.dataExplorer.statusBar.firstRowsTooltip',
			"Only the first {0} rows are shown. Sort or filter to see other rows.",
			numRows.toLocaleString()
		);
		const rows = backendState.row_filters.length > 0 ?
			renderCountedMessage(localize(
				'positron.dataExplorer.statusBar.firstMatchingRows',
				"First {0} of {1} matching rows ({2}% of {3} total)"
			), [
				numRows.toLocaleString(),
				totalNumRows.toLocaleString(),
				(backendState.table_unfiltered_shape.num_rows === 0 ? 0 :
					100 * totalNumRows / backendState.table_unfiltered_shape.num_rows).toFixed(2),
				backendState.table_unfiltered_shape.num_rows.toLocaleString(),
			]) :
			renderCountedMessage(localize(
				'positron.dataExplorer.statusBar.firstRows',
				"First {0} of {1} rows"
			), [numRows.toLocaleString(), totalNumRows.toLocaleString()]);

		return (
			<div className='status-bar' data-testid='status-bar' title={tooltip}>
				<StatusBarActivityIndicator />
				{rows}
				<span>&nbsp;&nbsp;</span>
				{renderCountedMessage(localize(
					'positron.dataExplorer.statusBar.columns',
					"{0} columns"
				), [numColumns.toLocaleString()])}
				<SearchStatus backendState={backendState} />
			</div>
		);
	}

	// Render.
	if (backendState && backendState.row_filters.length > 0) {
		const numUnfilteredRows = backendState.table_unfiltered_shape.num_rows;
		const pctFiltered = numUnfilteredRows === 0 ? 0 : 100 * numRows / numUnfilteredRows;

		return (
			<div className='status-bar' data-testid='status-bar'>
				<StatusBarActivityIndicator />
				{renderCountedMessage(localize(
					'positron.dataExplorer.statusBar.showingRows',
					"Showing {0} rows ({1}% of {2} total)"
				), [numRows.toLocaleString(), pctFiltered.toFixed(2), numUnfilteredRows.toLocaleString()])}
				<span>&nbsp;&nbsp;</span>
				{renderCountedMessage(localize(
					'positron.dataExplorer.statusBar.columns',
					"{0} columns"
				), [numColumns.toLocaleString()])}
				<SearchStatus backendState={backendState} />
			</div>
		);
	} else {
		return (
			<div className='status-bar' data-testid='status-bar'>
				<StatusBarActivityIndicator />
				<span className='counter'>{numRows.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>rows</span>
				<span>&nbsp;&nbsp;</span>
				<span className='counter'>{numColumns.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>columns</span>
			</div>
		);
	}
};
