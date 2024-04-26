/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./statusBar';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { DataExplorerClientStatus } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

interface ActivityIndicatorProps {
	status: DataExplorerClientStatus;
}

const StatusBarActivityIndicator = (props: ActivityIndicatorProps) => {
	const getStatusText = () => {
		// TODO: localize
		switch (props.status) {
			case DataExplorerClientStatus.Idle:
				return 'Idle';
			case DataExplorerClientStatus.Computing:
				return 'Computing';
			case DataExplorerClientStatus.Disconnected:
				return 'Disconnected';
			case DataExplorerClientStatus.Error:
				return 'Error';
		}
	};

	const getStatusClass = () => {
		switch (props.status) {
			case DataExplorerClientStatus.Idle:
				return 'idle';
			case DataExplorerClientStatus.Computing:
				return 'computing';
			case DataExplorerClientStatus.Disconnected:
				return 'disconnected';
			case DataExplorerClientStatus.Error:
				return 'error';
		}
	};

	return (
		<div className='status-bar-indicator'>
			{/* TODO: Use different CSS  */}
			<div className='action-bar-separator' aria-hidden='true' >
				<div className='action-bar-separator-icon codicon codicon-positron-separator' />
			</div>
			<div className={`title ${getStatusClass()}`}>
				{getStatusText()}
			</div>
		</div>
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
		context.instance.dataExplorerClientInstance.cachedBackendState);

	const [clientStatus, setClientStatus] = useState(
		context.instance.dataExplorerClientInstance.status);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidUpdateBackendState event handler.
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidUpdateBackendState(
			state => setBackendState(state)
		));

		// Set up onDidStatusUpdate event handler.
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidStatusUpdate(
			status => setClientStatus(status)
		));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.instance.dataExplorerClientInstance]);

	// Render.
	let numRows = 0;
	let numColumns = 0;
	if (backendState !== undefined) {
		numRows = backendState.table_shape.num_rows;
		numColumns = backendState?.table_shape.num_columns;
	}

	if (backendState && backendState.row_filters.length > 0) {
		const numUnfilteredRows = backendState.table_unfiltered_shape.num_rows;
		const pctFiltered = numUnfilteredRows === 0 ? 0 : 100 * numRows / numUnfilteredRows;

		return (
			<div className='status-bar'>
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
				<StatusBarActivityIndicator
					status={clientStatus}
				/>
			</div>
		);
	} else {
		return (
			<div className='status-bar'>
				<span className='counter'>{numRows.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>rows</span>
				<span>&nbsp;&nbsp;</span>
				<span className='counter'>{numColumns.toLocaleString()}</span>
				<span>&nbsp;</span>
				<span className='label'>columns</span>
				<StatusBarActivityIndicator
					status={clientStatus}
				/>
			</div>
		);
	}
};
