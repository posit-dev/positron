/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./statusBar';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * StatusBar component.
 * @returns The rendered component.
 */
export const StatusBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// State hooks.
	const [rows, setRows] = useState(context.instance.tableDataDataGridInstance.rows);
	const [columns, setColumns] = useState(context.instance.tableDataDataGridInstance.columns);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeLayout event handler.
		disposableStore.add(context.instance.tableDataDataGridInstance.onDidUpdate(() => {
			setRows(context.instance.tableDataDataGridInstance.rows);
			setColumns(context.instance.tableDataDataGridInstance.columns);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='status-bar'>
			<span className='counter'>{rows.toLocaleString()}</span>
			<span>&nbsp;</span>
			<span className='label'>rows</span>
			<span>&nbsp;&nbsp;</span>
			<span className='counter'>{columns.toLocaleString()}</span>
			<span>&nbsp;</span>
			<span className='label'>columns</span>
		</div>
	);
};
