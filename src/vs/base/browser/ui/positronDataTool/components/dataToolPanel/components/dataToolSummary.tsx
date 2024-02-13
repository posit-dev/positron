/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataToolSummary';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronDataToolContext } from 'vs/base/browser/ui/positronDataTool/positronDataToolContext';

/**
 * DataToolSummary component.
 * @returns The rendered component.
 */
export const DataToolSummary = () => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// State hooks.
	const [rows, setRows] = useState(context.instance.dataGridInstance.rows);
	const [columns, setColumns] = useState(context.instance.dataGridInstance.columns);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeLayout event handler.
		disposableStore.add(context.instance.dataGridInstance.onDidUpdate(() => {
			setRows(context.instance.dataGridInstance.rows);
			setColumns(context.instance.dataGridInstance.columns);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='data-tool-summary'>
			<span className='counter'>{rows}</span>
			<span>&nbsp;</span>
			<span className='label'>rows</span>
			<span>&nbsp;&nbsp;</span>
			<span className='counter'>{columns}</span>
			<span>&nbsp;</span>
			<span className='label'>columns</span>
		</div>
	);
};
