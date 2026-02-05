/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './InlineDataExplorer.css';

// React.
import React, { useEffect, useState, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { InlineTableDataGridInstance } from '../../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import { TableDataCache } from '../../../../services/positronDataExplorer/common/tableDataCache.js';
import { PositronDataGrid } from '../../../../browser/positronDataGrid/positronDataGrid.js';
import { ParsedDataExplorerOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY } from '../../common/positronNotebookConfig.js';
import { isMacintosh } from '../../../../../base/common/platform.js';

/**
 * InlineDataExplorerProps interface.
 */
interface InlineDataExplorerProps extends ParsedDataExplorerOutput {
	// Additional props if needed
}

/**
 * State for the inline data explorer component.
 */
type InlineDataExplorerState =
	| { status: 'loading' }
	| { status: 'connected'; gridInstance: InlineTableDataGridInstance }
	| { status: 'disconnected' }
	| { status: 'error'; message: string };

/**
 * InlineDataExplorerHeader component.
 */
function InlineDataExplorerHeader({ title, shape, onOpenInExplorer }: {
	title: string;
	shape: { rows: number; columns: number };
	onOpenInExplorer?: () => void;
}) {
	return (
		<div className='inline-data-explorer-header'>
			<div className='inline-data-explorer-info'>
				<span className='inline-data-explorer-title'>{title}</span>
				<span className='inline-data-explorer-shape'>
					{shape.rows.toLocaleString()} {localize('rows', 'rows')} x {shape.columns.toLocaleString()} {localize('columns', 'columns')}
				</span>
			</div>
			{onOpenInExplorer && (
				<button
					className='inline-data-explorer-open-button'
					title={localize('openInDataExplorer', 'Open in Data Explorer')}
					onClick={onOpenInExplorer}
				>
					<span className='codicon codicon-go-to-file' />
					{localize('openInDataExplorer', 'Open in Data Explorer')}
				</button>
			)}
		</div>
	);
}

/**
 * InlineDataExplorer component.
 *
 * Renders a simplified data explorer inline in notebook cell outputs.
 */
export function InlineDataExplorer(props: InlineDataExplorerProps) {
	const { commId, shape, title } = props;
	const services = PositronReactServices.services;
	const [state, setState] = useState<InlineDataExplorerState>({ status: 'loading' });
	const containerRef = useRef<HTMLDivElement>(null);
	// Don't create DisposableStore in useRef - it will leak on remount.
	// The store is created in the effect below.
	const disposablesRef = useRef<DisposableStore | null>(null);

	// Get data explorer service
	const dataExplorerService = services.positronDataExplorerService;

	// Get max height from configuration
	const maxHeight = services.configurationService.getValue<number>(
		POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY
	) ?? 300;

	useEffect(() => {
		// Create a fresh disposable store for this mount cycle
		const disposables = new DisposableStore();
		disposablesRef.current = disposables;

		// Clean up on unmount or when commId changes
		return () => {
			disposables.dispose();
			disposablesRef.current = null;
		};
	}, [commId]);

	useEffect(() => {
		const disposables = disposablesRef.current;
		let cancelled = false;

		async function initializeGrid() {
			try {
				// Check if store is already disposed (race condition protection)
				if (!disposables || disposables.isDisposed) {
					return;
				}

				// Wait for the instance to be available (with timeout)
				const instance = await dataExplorerService.getInstanceAsync(commId, 10000);

				if (cancelled || !disposables || disposables.isDisposed) {
					return;
				}

				if (!instance) {
					setState({
						status: 'error',
						message: localize('instanceNotFound', 'Data explorer instance not found. Re-run the cell to view the data.')
					});
					return;
				}

				// Create the table data cache for this inline view
				const clientInstance = instance.dataExplorerClientInstance;
				const tableDataCache = disposables.add(new TableDataCache(clientInstance));

				// Create the inline grid instance
				const gridInstance = disposables.add(new InlineTableDataGridInstance(
					clientInstance,
					tableDataCache
				));

				// Listen for close event
				disposables.add(gridInstance.onDidClose(() => {
					if (!cancelled) {
						setState({ status: 'disconnected' });
					}
				}));

				// Initialize the grid - this fetches backend state and sets up layout before fetching data
				await gridInstance.initialize();

				if (cancelled || disposables.isDisposed) {
					return;
				}

				setState({
					status: 'connected',
					gridInstance
				});
			} catch (error) {
				if (!cancelled) {
					setState({
						status: 'error',
						message: error instanceof Error ? error.message : String(error)
					});
				}
			}
		}

		initializeGrid();

		return () => {
			cancelled = true;
		};
	}, [commId, dataExplorerService]);

	const handleOpenInExplorer = async () => {
		// Try to get the instance synchronously first
		let instance = dataExplorerService.getInstance(commId);

		// If not found, try async lookup in case of timing issue
		if (!instance) {
			instance = await dataExplorerService.getInstanceAsync(commId, 2000);
		}

		if (instance) {
			instance.requestFocus();
		} else {
			// Notify user that the instance could not be found
			services.notificationService.warn(
				localize('dataExplorerNotFound', 'Unable to open Data Explorer. Please re-run the cell.')
			);
		}
	};

	// Stop wheel events from propagating to the notebook container
	const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		e.stopPropagation();
	};

	// Check if grid instance has become stale (no data but still "connected")
	const isGridStale = state.status === 'connected' &&
		(state.gridInstance.columns === 0 || state.gridInstance.rows === 0);

	// Handle keyboard events for copy (Cmd+C / Ctrl+C)
	const handleKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
		// Check for Cmd+C (Mac) or Ctrl+C (Windows/Linux)
		if (e.code === 'KeyC' && (isMacintosh ? e.metaKey : e.ctrlKey)) {
			if (state.status === 'connected' && !isGridStale) {
				e.preventDefault();
				e.stopPropagation();
				await state.gridInstance.copyToClipboard();
			}
		}
	};

	// Render based on state
	return (
		<div ref={containerRef} className='inline-data-explorer-container' style={{ height: `${maxHeight}px` }}>
			<InlineDataExplorerHeader
				shape={shape}
				title={title}
				onOpenInExplorer={state.status === 'connected' && !isGridStale ? handleOpenInExplorer : undefined}
			/>
			<div className='inline-data-explorer-content' onKeyDownCapture={handleKeyDown} onWheel={handleWheel}>
				{state.status === 'loading' && (
					<div className='inline-data-explorer-loading'>
						<span className='codicon codicon-loading codicon-modifier-spin' />
						{localize('loading', 'Loading...')}
					</div>
				)}
				{state.status === 'connected' && !isGridStale && (
					<PositronDataGrid
						instance={state.gridInstance}
					/>
				)}
				{state.status === 'connected' && isGridStale && (
					<div className='inline-data-explorer-disconnected'>
						<span className='codicon codicon-warning' />
						{localize('dataStale', 'Data connection lost. Re-run cell to view.')}
					</div>
				)}
				{state.status === 'disconnected' && (
					<div className='inline-data-explorer-disconnected'>
						<span className='codicon codicon-warning' />
						{localize('dataUnavailable', 'Data unavailable. Re-run cell to view.')}
					</div>
				)}
				{state.status === 'error' && (
					<div className='inline-data-explorer-error'>
						<span className='codicon codicon-error' />
						{state.message}
					</div>
				)}
			</div>
		</div>
	);
}
