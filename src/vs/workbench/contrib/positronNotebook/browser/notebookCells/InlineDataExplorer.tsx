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
	const disposablesRef = useRef<DisposableStore>(new DisposableStore());

	// Get data explorer service
	const dataExplorerService = services.positronDataExplorerService;

	// Get max height from configuration
	const maxHeight = services.configurationService.getValue<number>(
		POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY
	) ?? 300;

	useEffect(() => {
		const disposables = disposablesRef.current;

		// Clean up on unmount or when commId changes
		return () => {
			disposables.dispose();
			disposablesRef.current = new DisposableStore();
		};
	}, [commId]);

	useEffect(() => {
		const disposables = disposablesRef.current;
		let cancelled = false;

		async function initializeGrid() {
			try {
				// Wait for the instance to be available (with timeout)
				const instance = await dataExplorerService.getInstanceAsync(commId, 10000);

				if (cancelled) {
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

				// Initialize the grid
				await gridInstance.fetchData();

				if (cancelled) {
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

	const handleOpenInExplorer = () => {
		// The data explorer editor should already be open since the instance is registered
		// Focus on the existing editor
		const instance = dataExplorerService.getInstance(commId);
		if (instance) {
			instance.requestFocus();
		}
	};

	// Stop wheel events from propagating to the notebook container
	const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		e.stopPropagation();
	};

	// Render based on state
	return (
		<div ref={containerRef} className='inline-data-explorer-container' style={{ height: `${maxHeight}px` }}>
			<InlineDataExplorerHeader
				shape={shape}
				title={title}
				onOpenInExplorer={state.status === 'connected' ? handleOpenInExplorer : undefined}
			/>
			<div className='inline-data-explorer-content' onWheel={handleWheel}>
				{state.status === 'loading' && (
					<div className='inline-data-explorer-loading'>
						<span className='codicon codicon-loading codicon-modifier-spin' />
						{localize('loading', 'Loading...')}
					</div>
				)}
				{state.status === 'connected' && (
					<PositronDataGrid
						instance={state.gridInstance}
					/>
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
