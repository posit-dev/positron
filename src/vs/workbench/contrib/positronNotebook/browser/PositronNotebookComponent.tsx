/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronNotebookComponent.css';
import './positronNotebookScrollable.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { useNotebookInstance, useNotebookOptions } from './NotebookInstanceProvider.js';
import { AddCellButtons } from './AddCellButtons.js';
import { useObservedValue } from './useObservedValue.js';
import { NotebookCodeCell } from './notebookCells/NotebookCodeCell.js';
import { NotebookMarkdownCell } from './notebookCells/NotebookMarkdownCell.js';
import { NotebookRawCell } from './notebookCells/NotebookRawCell.js';
import { DeletionSentinel } from './notebookCells/DeletionSentinel.js';
import { GhostCell } from './contrib/ghostCell/GhostCell.js';
import { SortableCellList } from './notebookCells/SortableCellList.js';
import { SortableCell } from './notebookCells/SortableCell.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCells/PositronNotebookCell.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useScrollObserver } from './notebookCells/useScrollObserver.js';
import { ScreenReaderOnly } from '../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { createBareFontInfoFromRawSettings } from '../../../../editor/common/config/fontInfoFromSettings.js';
import { useScopedContextKey } from '../../../../base/browser/positronReactHooks.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../editor/contrib/find/browser/findModel.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { IDeletionSentinel } from './IPositronNotebookInstance.js';
import { NotebookErrorBoundary } from './NotebookErrorBoundary.js';
import { getSelectedCells } from './selectionMachine.js';
import { startScrollRestorationLoop } from './scrollRestorationLoop.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { NotebookDisplayOptions, NotebookLayoutConfiguration } from '../../notebook/browser/notebookOptions.js';
import { useScrollBeyondLastLinePadding } from './useScrollBeyondLastLinePadding.js';

export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	const deletionSentinels = useObservedValue(notebookInstance.deletionSentinels);
	const fontStyles = useFontStyles();
	const containerRef = React.useRef<HTMLDivElement>(null);
	const services = usePositronReactServicesContext();

	// Accessibility: Global announcements for notebook-level operations (cell add/delete).
	// These are rendered in a ScreenReaderOnly ARIA live region for screen reader users.
	const [globalAnnouncement, setGlobalAnnouncement] = React.useState<string>('');
	const previousCellCount = React.useRef<number>(notebookCells.length);

	// Track scroll position for scroll decoration
	const [isScrolled, setIsScrolled] = React.useState(false);

	// Track find widget visibility for scroll decoration
	const isFindWidgetVisible = useScopedContextKey(
		CONTEXT_FIND_WIDGET_VISIBLE,
		notebookInstance.scopedContextKeyService
	);

	// Attach the container in the callback ref so it's available synchronously
	// during the commit phase, before the scroll-restoration layout effect runs.
	const containerCallbackRef = React.useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		notebookInstance.setCellsContainer(node);
	}, [notebookInstance]);

	// Re-fire the layout effect on each restoreEditorViewState call so the
	// cache-hit setInput path (where the React tree is reused) still drives
	// scroll restoration.
	const restoreRequest = useObservedValue(notebookInstance.restoreScrollPositionRequest);

	React.useLayoutEffect(() => {
		const scrollPosition = notebookInstance.consumeRestoredScrollPosition();
		if (!scrollPosition) { return; }

		const container = containerRef.current;
		if (!container) { return; }

		const disposable = startScrollRestorationLoop(container, () => {
			const cellTop = notebookInstance.getCellTop(scrollPosition.cell);
			return cellTop === undefined ? undefined : cellTop + scrollPosition.offsetFromCell;
		}, services.logService);
		return () => disposable.dispose();
	}, [restoreRequest, notebookInstance, services.logService]);

	// Track cell count changes and announce to screen readers
	React.useEffect(() => {
		const currentCount = notebookCells.length;
		const previousCount = previousCellCount.current;

		if (currentCount > previousCount) {
			const added = currentCount - previousCount;
			setGlobalAnnouncement(`${added} cell${added > 1 ? 's' : ''} added. Total: ${currentCount}`);
		} else if (currentCount < previousCount) {
			const removed = previousCount - currentCount;
			setGlobalAnnouncement(`${removed} cell${removed > 1 ? 's' : ''} removed. Total: ${currentCount}`);
		}

		previousCellCount.current = currentCount;
	}, [notebookCells.length]);

	// In web mode, BrowserWindow (window.ts) registers an unconditional
	// preventDefault() on wheel events on the mainContainer (.monaco-workbench)
	// to block macOS back/forward gestures. Because it's non-passive and fires
	// during bubble, it cancels native scrolling for ALL descendants that rely
	// on overflow:auto. stopPropagation() here prevents the event from reaching
	// that listener. Harmless in Electron where NativeWindow has no such handler.
	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) { return; }
		const handler = (e: WheelEvent) => { e.stopPropagation(); };
		container.addEventListener('wheel', handler);
		return () => container.removeEventListener('wheel', handler);
	}, []);

	// Observe scroll events and fire to notebook instance, also track scroll position
	useScrollObserver(containerRef as React.RefObject<HTMLElement>, React.useCallback(() => {
		notebookInstance.fireScrollEvent();
		setIsScrolled((containerRef.current?.scrollTop ?? 0) > 0);
	}, [notebookInstance]));

	// Determine if scroll decoration should be shown
	const showDecoration = isScrolled || isFindWidgetVisible;

	// Handler for drag-and-drop reordering of cells (single or multi).
	// Guard against read-only notebooks to prevent unintended reorders.
	const handleReorder = React.useCallback((cells: IPositronNotebookCell[], targetIndex: number) => {
		if (notebookInstance.isReadOnly) {
			return;
		}
		notebookInstance.moveCells(cells, targetIndex);
	}, [notebookInstance]);

	// Get currently selected cells for multi-drag support
	const getSelectedCellsCallback = React.useCallback(() => {
		return getSelectedCells(notebookInstance.selectionStateMachine.state.get());
	}, [notebookInstance]);

	const scrollBeyondLastLinePadding = useScrollBeyondLastLinePadding(
		notebookInstance.height,
	);

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			{showDecoration && (
				<div
					aria-hidden='true'
					className='scroll-decoration'
					role='presentation'
				/>
			)}
			<div ref={containerCallbackRef} className='positron-notebook-cells-container positron-notebook-scrollable' style={{ paddingBlockEnd: scrollBeyondLastLinePadding }}>
				<SortableCellList
					cells={notebookCells}
					getSelectedCells={getSelectedCellsCallback}
					onReorder={handleReorder}
				>
					<AddCellButtons index={0} />
					{renderCellsAndSentinels(notebookCells, deletionSentinels, services)}
				</SortableCellList>
				<GhostCell />
			</div>
			<ScreenReaderOnly className='notebook-announcements'>
				{globalAnnouncement}
			</ScreenReaderOnly>
		</div>
	);
}

/**
 * Renders cells and sentinels in the correct order.
 * Sentinels are positioned based on their originalIndex relative to
 * the cumulative position in the rendered notebook.
 *
 * Algorithm:
 * 1. Sort sentinels by originalIndex for efficient processing
 * 2. Track currentOriginalIndex as we iterate through cells
 * 3. Before rendering each cell, insert all sentinels with originalIndex <= currentOriginalIndex
 * 4. Increment currentOriginalIndex for both cells and sentinels
 * 5. After all cells, render any remaining sentinels
 *
 * Example: If cells 2 and 3 are deleted from [0, 1, 2, 3, 4]:
 * - Remaining cells: [0, 1, 4]
 * - Sentinels: [{originalIndex: 2}, {originalIndex: 3}]
 * - Result: 0, 1, sentinel(2), sentinel(3), 4
 */
function renderCellsAndSentinels(
	cells: IPositronNotebookCell[],
	sentinels: readonly IDeletionSentinel[],
	services: any
): React.ReactElement[] {
	const elements: React.ReactElement[] = [];
	let currentOriginalIndex = 0;

	// Sort sentinels by originalIndex for efficient processing
	const sortedSentinels = [...sentinels].sort((a, b) => a.originalIndex - b.originalIndex);
	let sentinelIndex = 0;

	cells.forEach((cell, cellArrayIndex) => {
		// Render all sentinels that should appear before this cell
		while (sentinelIndex < sortedSentinels.length &&
			sortedSentinels[sentinelIndex].originalIndex <= currentOriginalIndex) {
			const sentinel = sortedSentinels[sentinelIndex];
			elements.push(
				<DeletionSentinel
					key={sentinel.id}
					configurationService={services.configurationService}
					sentinel={sentinel}
				/>
			);
			sentinelIndex++;
			currentOriginalIndex++;
		}

		// Render the cell wrapped in SortableCell for drag-and-drop
		elements.push(
			<React.Fragment key={cell.handle}>
				<NotebookErrorBoundary
					componentName={`Cell[${cell.handle}]`}
					level='cell'
					logService={services.logService}
				>
					<SortableCell cell={cell}>
						<NotebookCell cell={cell as PositronNotebookCellGeneral} />
					</SortableCell>
				</NotebookErrorBoundary>
				<AddCellButtons index={cellArrayIndex + 1} />
			</React.Fragment>
		);
		currentOriginalIndex++;
	});

	// Render any remaining sentinels at the end
	while (sentinelIndex < sortedSentinels.length) {
		const sentinel = sortedSentinels[sentinelIndex];
		elements.push(
			<DeletionSentinel
				key={sentinel.id}
				configurationService={services.configurationService}
				sentinel={sentinel}
			/>
		);
		sentinelIndex++;
	}

	return elements;
}

/**
 * Resolve rendered-markdown font values from notebook.markup.* settings. Falls back to
 * `inherit` so unset values cascade from .monaco-workbench when not set. Unlike the
 * legacy notebook editor, we do not default the font size to 1.2 times the base font size
 * being used for the notebook.
 */
function getMarkdownFontStyles(layout: NotebookLayoutConfiguration & NotebookDisplayOptions) {
	return {
		fontSize: layout.markupFontSize > 0
			? `${layout.markupFontSize}px`
			: 'inherit',
		lineHeight: layout.markdownLineHeight > 0
			? `${layout.markdownLineHeight}px`
			: 'inherit',
		fontFamily: layout.markupFontFamily || 'inherit',
	};
}

/**
 * Resolve text-output font values. The font family is derived from editor font measurements
 * (we want text outputs to match the editor's monospace font), so this helper needs the
 * configuration service and target window in addition to the notebook layout.
 */
function getOutputFontStyles(
	layout: NotebookLayoutConfiguration & NotebookDisplayOptions,
	configurationService: IConfigurationService,
	targetWindow: Window,
) {
	const editorOptions = configurationService.getValue<IEditorOptions>('editor');
	const fontInfo = FontMeasurements.readFontInfo(targetWindow, createBareFontInfoFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value));
	const fontFamily = fontInfo.fontFamily ?? `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`;

	return {
		fontSize: `${layout.outputFontSize}px`,
		fontFamily,
		maxHeight: `${layout.outputLineHeight * layout.outputLineLimit}px`,
	};
}

function useFontStyles(): React.CSSProperties {
	const services = usePositronReactServicesContext();
	const notebookOptions = useNotebookOptions();
	const layout = notebookOptions.getLayoutConfiguration();
	const targetWindow = DOM.getActiveWindow();

	const markdown = getMarkdownFontStyles(layout);
	const output = getOutputFontStyles(layout, services.configurationService, targetWindow);

	return {
		['--vscode-positronNotebook-text-output-font-family' as string]: output.fontFamily,
		['--vscode-positronNotebook-text-output-font-size' as string]: output.fontSize,
		['--vscode-positronNotebook-output-max-height' as string]: output.maxHeight,
		['--vscode-positronNotebook-markdown-font-size' as string]: markdown.fontSize,
		['--vscode-positronNotebook-markdown-line-height' as string]: markdown.lineHeight,
		['--vscode-positronNotebook-markdown-font-family' as string]: markdown.fontFamily,
	};
}

function NotebookCell({ cell }: {
	cell: PositronNotebookCellGeneral;
}) {

	if (cell.isRawCell()) {
		return <NotebookRawCell cell={cell} />;
	}

	if (cell.isCodeCell()) {
		return <NotebookCodeCell cell={cell} />;
	}

	if (cell.isMarkdownCell()) {
		return <NotebookMarkdownCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}
