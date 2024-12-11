/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './statusBar.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { StatusBarActivityIndicator } from './statusBarActivityIndicator.js';

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

	// Render.
	if (backendState && backendState.row_filters.length > 0) {
		const numUnfilteredRows = backendState.table_unfiltered_shape.num_rows;
		const pctFiltered = numUnfilteredRows === 0 ? 0 : 100 * numRows / numUnfilteredRows;

		return (
			<div className='status-bar'>
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
			<div className='status-bar'>
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
