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
				<span className='label'>Showing</span>
				<span>&nbsp;</span>
				<span className='counter'>{numRows.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>rows&nbsp;(</span>
				<span className='counter'>{pctFiltered.toFixed(2)}%</span>
				<span className='label'>&nbsp;of&nbsp;</span>
				<span className='counter'>{numUnfilteredRows.toLocaleString()}</span>
				<span className='label'>&nbsp;total)</span>
				<span>&nbsp;&nbsp;</span>
				<span className='counter'>{numColumns.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>columns</span>
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
