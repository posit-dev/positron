/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import '../../positronNotebook/browser/notebookCells/InlineDataExplorer.css';
import './quartoInlineDataExplorer.css';

// React.
import React, { useEffect, useState, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import { InlineTableDataGridInstance } from '../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import { TableDataCache } from '../../../services/positronDataExplorer/common/tableDataCache.js';
import { PositronDataGrid } from '../../../browser/positronDataGrid/positronDataGrid.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { POSITRON_QUARTO_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY } from '../common/positronQuartoConfig.js';
import { isMacintosh } from '../../../../base/common/platform.js';

// Height calculation constants (from inlineTableDataGridInstance.tsx constructor options).
const COLUMN_HEADERS_HEIGHT = 34; // columnHeadersHeight in grid options
const ROW_HEIGHT = 22;            // defaultRowHeight
const TOOLBAR_HEIGHT = 26;        // Header bar (24px CSS height + 1px border-bottom + 1px padding)
const BORDER = 2;                 // 1px top + 1px bottom border on outer container
const SCROLLBAR_HEIGHT = 10;      // horizontalScrollbar thickness

const calculateHeight = (rowCount: number, maxHeight: number): number => {
	const naturalHeight = TOOLBAR_HEIGHT + COLUMN_HEADERS_HEIGHT + (rowCount * ROW_HEIGHT) + SCROLLBAR_HEIGHT + BORDER;
	return Math.min(naturalHeight, maxHeight);
};

/**
 * QuartoInlineDataExplorerProps interface.
 */
export interface QuartoInlineDataExplorerProps {
	commId: string;
	shape: { rows: number; columns: number };
	title: string;
	variablePath?: string[];
	documentUri: URI;
	onFallback?: () => void;
	onHeightChange?: (height: number) => void;
}

/**
 * State for the inline data explorer component.
 */
type QuartoInlineDataExplorerState =
	| { status: 'loading' }
	| { status: 'connected'; gridInstance: InlineTableDataGridInstance }
	| { status: 'disconnected' }
	| { status: 'error'; message: string };

/**
 * Header component for the inline data explorer.
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
 * QuartoInlineDataExplorer component.
 *
 * Renders a simplified data explorer inline in Quarto document output view zones.
 */
export function QuartoInlineDataExplorer(props: QuartoInlineDataExplorerProps) {
	const { commId, shape, title, variablePath, documentUri, onFallback, onHeightChange } = props;
	const services = PositronReactServices.services;
	const [state, setState] = useState<QuartoInlineDataExplorerState>({ status: 'loading' });
	const containerRef = useRef<HTMLDivElement>(null);
	const disposablesRef = useRef<DisposableStore | null>(null);

	const dataExplorerService = services.positronDataExplorerService;

	const maxHeight = services.configurationService.getValue<number>(
		POSITRON_QUARTO_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY
	) ?? 300;

	// Notify parent of calculated height.
	const dynamicHeight = calculateHeight(shape.rows, maxHeight);
	useEffect(() => {
		onHeightChange?.(dynamicHeight);
	}, [dynamicHeight, onHeightChange]);

	useEffect(() => {
		const disposables = new DisposableStore();
		disposablesRef.current = disposables;

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

				const clientInstance = instance.dataExplorerClientInstance;
				const tableDataCache = disposables.add(new TableDataCache(clientInstance));

				const gridInstance = disposables.add(new InlineTableDataGridInstance(
					clientInstance,
					tableDataCache
				));

				disposables.add(gridInstance.onDidClose(() => {
					if (!cancelled) {
						setState({ status: 'disconnected' });
					}
				}));

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

	const handleOpenInExplorer = () => {
		services.commandService.executeCommand('positron-data-explorer.openFromInline', {
			commId,
			variablePath,
			notebookUri: documentUri,
		});
	};

	const isGridStale = state.status === 'connected' &&
		(state.gridInstance.columns === 0 || state.gridInstance.rows === 0);

	const handleKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.code === 'KeyC' && (isMacintosh ? e.metaKey : e.ctrlKey)) {
			if (state.status === 'connected' && !isGridStale) {
				e.preventDefault();
				e.stopPropagation();
				await state.gridInstance.copyToClipboard();
			}
		}
	};

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
