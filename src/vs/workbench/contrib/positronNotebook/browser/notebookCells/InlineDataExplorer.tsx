/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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

// Height calculation constants (from inlineTableDataGridInstance.tsx constructor options)
const HEADER_HEIGHT = 28;  // columnHeadersHeight
const ROW_HEIGHT = 22;     // defaultRowHeight
const TOOLBAR_HEIGHT = 32; // Component header with row/col counts
const PADDING = 8;

const calculateHeight = (rowCount: number, maxHeight: number): number => {
	// Calculate natural height based on content
	const naturalHeight = TOOLBAR_HEIGHT + HEADER_HEIGHT + (rowCount * ROW_HEIGHT) + PADDING;

	// Apply max constraint (no min to allow very small tables)
	return Math.min(naturalHeight, maxHeight);
};

/**
 * InlineDataExplorerProps interface.
 */
interface InlineDataExplorerProps extends ParsedDataExplorerOutput {
	/** Called when the data explorer instance can't be found quickly, signaling
	 *  the parent to render a fallback (e.g. HTML table) instead. */
	onFallback?: () => void;
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
	const { commId, shape, title, onFallback } = props;
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

				// When a fallback is available, use a short timeout since comms
				// register within milliseconds during normal execution. On reload,
				// the comm won't exist so we fall back quickly instead of waiting.
				const timeout = onFallback ? 500 : 10000;
				const instance = await dataExplorerService.getInstanceAsync(commId, timeout);

				if (cancelled || !disposables || disposables.isDisposed) {
					return;
				}

				if (!instance) {
					if (onFallback) {
						onFallback();
						return;
					}
					setState({
						status: 'error',
						message: localize('instanceNotFound', 'Data explorer instance not found. Re-run the cell to view the data.')
					});
					return;
				}

				// Do NOT dispose the client on unmount. The inline view may unmount
				// temporarily (e.g., when switching editor tabs) and remount when
				// the notebook becomes active again. The comm lifecycle is managed
				// by the kernel (closed on cell re-execution or kernel restart)
				// and by the DataExplorerRuntime (closed on session end).

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
	}, [commId, dataExplorerService, onFallback]);

	const handleOpenInExplorer = async () => {
		const instance = dataExplorerService.getInstance(commId);
		if (!instance) {
			services.notificationService.warn(
				localize('dataExplorerNotFound', 'Unable to open Data Explorer. Please re-run the cell.')
			);
			return;
		}

		try {
			// Request kernel to create a new, independent data explorer.
			// The kernel creates a new comm which auto-opens an editor tab.
			// Note: the RPC response may not arrive if the inline view
			// unmounts (disposing the comm) before the response is delivered.
			// This is expected -- the new editor tab opens regardless.
			await instance.dataExplorerClientInstance.openDataExplorer();
		} catch (error) {
			// The RPC may "fail" because the inline view's comm was disposed
			// before the response arrived (the new editor tab opening causes
			// the notebook to deactivate, unmounting this component). This is
			// fine -- the new editor tab was already created by the kernel.
			// Only show an error for genuine MethodNotFound failures, which
			// indicate the kernel doesn't support this method.
			const isMethodNotFound = error && typeof error === 'object' &&
				'code' in error && typeof (error as Record<string, unknown>).code === 'number' &&
				(error as Record<string, unknown>).code === -32601;
			if (isMethodNotFound) {
				services.notificationService.warn(
					localize('openDataExplorerNotSupported', 'Opening a full Data Explorer from inline view is not supported by this kernel.')
				);
			} else {
				console.warn('openDataExplorer RPC error (likely benign comm-disposed race):', error);
			}
		}
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

	// Calculate dynamic height based on row count
	const dynamicHeight = calculateHeight(shape.rows, maxHeight);

	// Render based on state
	return (
		<div ref={containerRef} className='inline-data-explorer-container' style={{ height: `${dynamicHeight}px` }}>
			<InlineDataExplorerHeader
				shape={shape}
				title={title}
				onOpenInExplorer={state.status === 'connected' && !isGridStale ? handleOpenInExplorer : undefined}
			/>
			<div className='inline-data-explorer-content' onKeyDownCapture={handleKeyDown}>
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
