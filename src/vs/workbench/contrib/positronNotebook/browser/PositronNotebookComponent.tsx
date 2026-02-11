/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronNotebookComponent.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { AddCellButtons } from './AddCellButtons.js';
import { useObservedValue } from './useObservedValue.js';
import { NotebookCodeCell } from './notebookCells/NotebookCodeCell.js';
import { NotebookMarkdownCell } from './notebookCells/NotebookMarkdownCell.js';
import { NotebookRawCell } from './notebookCells/NotebookRawCell.js';
import { DeletionSentinel } from './notebookCells/DeletionSentinel.js';
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
import { useContextKeyValue } from './useContextKeyValue.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../editor/contrib/find/browser/findModel.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { IDeletionSentinel } from './IPositronNotebookInstance.js';
import { getSelectedCells } from './selectionMachine.js';


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
	const isFindWidgetVisible = useContextKeyValue(
		notebookInstance.scopedContextKeyService,
		CONTEXT_FIND_WIDGET_VISIBLE
	);

	React.useEffect(() => {
		notebookInstance.setCellsContainer(containerRef.current);
		// Initial scroll check
		if (containerRef.current) {
			setIsScrolled(containerRef.current.scrollTop > 0);
		}
	}, [notebookInstance]);

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

	// Observe scroll events and fire to notebook instance, also track scroll position
	useScrollObserver(containerRef as React.RefObject<HTMLElement>, React.useCallback(() => {
		notebookInstance.fireScrollEvent();
		setIsScrolled((containerRef.current?.scrollTop ?? 0) > 0);
	}, [notebookInstance]));

	// Determine if scroll decoration should be shown
	const showDecoration = isScrolled || isFindWidgetVisible;

	// Handler for drag-and-drop reordering of cells
	const handleReorder = React.useCallback((oldIndex: number, newIndex: number) => {
		notebookInstance.moveCell(oldIndex, newIndex);
	}, [notebookInstance]);

	// Handler for batch drag-and-drop reordering of multiple cells
	const handleBatchReorder = React.useCallback((fromIndices: number[], toIndex: number) => {
		const cellsToMove = fromIndices.map(i => notebookCells[i]).filter(Boolean);
		notebookInstance.moveCells(cellsToMove, toIndex);
	}, [notebookCells, notebookInstance]);

	// Get selected cell IDs for multi-drag support
	const selectionState = useObservedValue(notebookInstance.selectionStateMachine.state);
	const selectedIds = React.useMemo(
		() => getSelectedCells(selectionState).map(c => c.handleId),
		[selectionState]
	);

	// Check if notebook is read-only
	const isReadOnly = notebookInstance.isReadOnly;

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			{showDecoration && (
				<div
					aria-hidden='true'
					className='scroll-decoration'
					role='presentation'
				/>
			)}
			<div ref={containerRef} className='positron-notebook-cells-container'>
				<AddCellButtons index={0} />
				<SortableCellList
					cells={notebookCells}
					disabled={isReadOnly}
					scrollContainerRef={containerRef}
					selectedIds={selectedIds}
					onBatchReorder={handleBatchReorder}
					onReorder={handleReorder}
				>
					{renderCellsAndSentinels(notebookCells, deletionSentinels, services)}
				</SortableCellList>
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
				<SortableCell cell={cell}>
					<NotebookCell cell={cell as PositronNotebookCellGeneral} />
				</SortableCell>
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
 * Get css properties for fonts in the notebook.
 * @returns A css properties object that sets css variables associated with fonts in the notebook.
 */
function useFontStyles(): React.CSSProperties {
	const services = usePositronReactServicesContext();

	const editorOptions = services.configurationService.getValue<IEditorOptions>('editor');
	const targetWindow = DOM.getActiveWindow();
	const fontInfo = FontMeasurements.readFontInfo(targetWindow, createBareFontInfoFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value));
	const family = fontInfo.fontFamily ?? `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`;

	return {
		['--vscode-positronNotebook-text-output-font-family' as string]: family,
		['--vscode-positronNotebook-text-output-font-size' as string]: `${fontInfo.fontSize}px`,
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
