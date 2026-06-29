/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellWrapper.css';
import './NotebookCellSelection.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, SelectionState } from '../selectionMachine.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useObservedValue } from '../useObservedValue.js';
import { NotebookCellActionBar } from './NotebookCellActionBar.js';
import { CellTagsBar } from './CellTagsBar.js';
import { CellProvider } from './CellProvider.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { NotebookErrorBoundary } from '../NotebookErrorBoundary.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../editor/contrib/find/browser/findModel.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { getWindow } from '../../../../../base/browser/dom.js';

const OUTPUT_SECTION_CLASS = 'positron-notebook-cell-outputs';

function isActiveElementInOutputSection(cellElement: HTMLElement): boolean {
	const activeElement = getWindow(cellElement).document.activeElement;
	if (!activeElement || !cellElement.contains(activeElement)) {
		return false;
	}
	let el: Element | null = activeElement;
	while (el && el !== cellElement) {
		if (el.classList.contains(OUTPUT_SECTION_CLASS)) {
			return true;
		}
		el = el.parentElement;
	}
	return false;
}

export function NotebookCellWrapper({ cell, children }: {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}) {
	const [cellElement, setCellElement] = React.useState<HTMLDivElement | null>(null);

	// Attach the container in the callback ref so cell.container is available
	// synchronously during the commit phase, before the scroll-restoration
	// layout effect reads it via getCellTop.
	const cellRef = React.useCallback((node: HTMLDivElement | null) => {
		setCellElement(node);
		if (node) {
			// Attach the container so the cell instance can properly control focus.
			cell.attachContainer(node);
		}
	}, [cell]);

	const services = usePositronReactServicesContext();
	const notebookInstance = useNotebookInstance();
	const selectionStateMachine = notebookInstance.selectionStateMachine;
	const selectionStatus = useObservedValue(cell.selectionStatus);
	const isActiveCell = useObservedValue(cell.isActive);
	// Track previous selection status to detect edit mode exit
	const prevSelectionStatusRef = React.useRef<CellSelectionStatus | undefined>(undefined);

	// Focus management: focus when this cell becomes the active cell
	React.useLayoutEffect(() => {
		const prevStatus = prevSelectionStatusRef.current;
		prevSelectionStatusRef.current = selectionStatus;

		if (!cellElement) {
			return;
		}

		/**
		 * Focus the cell container element when this cell becomes the active cell,
		 * except when:*/
		const wasEditingCodeCell = prevStatus === CellSelectionStatus.Editing &&
			(cell.isCodeCell() || cell.isRawCell());
		const findWidgetFocused = notebookInstance.scopedContextKeyService &&
			(CONTEXT_FIND_INPUT_FOCUSED.getValue(notebookInstance.scopedContextKeyService) ||
				CONTEXT_REPLACE_INPUT_FOCUSED.getValue(notebookInstance.scopedContextKeyService));
		if (isActiveCell &&
			// 1. In editing mode (the Monaco editor should have focus then)
			selectionStatus !== CellSelectionStatus.Editing &&
			// 2. Transitioning from Editing state for CODE cells only
			//    (markdown cells should still get container focus since their editor unmounts)
			!wasEditingCodeCell &&
			// 3. The find widget is focused (to keep focus in the find input)
			!findWidgetFocused &&
			// 4. Focus is on the output section (which is deliberately focusable for Cmd+C)
			!isActiveElementInOutputSection(cellElement)) {
			cellElement.focus();
		}
	}, [isActiveCell, selectionStatus, cellElement, cell, notebookInstance]);

	const cellType = cell.isRawCell() ? 'Raw' : cell.isCodeCell() ? 'Code' : 'Markdown';
	const cellTypeLower = cellType.toLowerCase();
	const isSelected = selectionStatus === CellSelectionStatus.Selected || selectionStatus === CellSelectionStatus.Editing;

	/**
	 * Check if the cell has outputs to determine aria-label.
	 * When there are no outputs, the focus trap is skipped, so we need to include
	 * the "Press Enter to edit" instruction in the cell container's aria-label.
	 */
	const hasOutputs = cell.outputsViewModels.length > 0;

	// State for ARIA announcements
	const [announcement, setAnnouncement] = React.useState<string>('');

	React.useLayoutEffect(() => {
		const cellIndex = cell.index;
		const cells = notebookInstance.cells.get();
		const totalCells = cells.length;

		// Announce selection changes for screen readers
		if (selectionStatus === CellSelectionStatus.Selected) {
			setAnnouncement(`Cell ${cellIndex + 1} of ${totalCells} selected`);
		} else if (selectionStatus === CellSelectionStatus.Editing) {
			setAnnouncement(`Editing cell ${cellIndex + 1} of ${totalCells}`);
		} else if (selectionStatus === CellSelectionStatus.Unselected) {
			// Clear announcement when unselected
			setAnnouncement('');
		}

		/**
		 * Close other markdown cell editors when this cell is selected or enters edit mode
		 * This ensures only one markdown cell editor is open at a time.
		 *
		 * Note: We do not want to close other editors when this cell is unselected,
		 * as that would interfere with multi-cell selection -> editing transitions
		 * where multiple cells become unselected.
		 */
		if (selectionStatus === CellSelectionStatus.Selected || selectionStatus === CellSelectionStatus.Editing) {
			for (const otherCell of cells) {
				if (otherCell !== cell && otherCell.isMarkdownCell() && otherCell.editorShown.get()) {
					otherCell.toggleEditor();
				}
			}
		}
	}, [selectionStatus, cell, notebookInstance]);

	return <div
		ref={cellRef}
		aria-label={hasOutputs
			? localize('notebookCell', '{0} cell', cellType)
			: localize('notebookCellEditable', '{0} cell - Press Enter to edit', cellType)}
		aria-selected={isSelected}
		className={positronClassNames(
			'positron-notebook-cell',
			`positron-notebook-${cellTypeLower}-cell`,
			selectionStatus,
		)}
		data-testid='notebook-cell'
		role='article'
		tabIndex={0}
		onClick={(e) => {
			// If a modifier key is held, treat as multi-select regardless of
			// where in the cell the click landed (including inside the editor).
			const addMode = e.shiftKey || e.ctrlKey || e.metaKey;
			if (addMode) {
				const stateBefore = selectionStateMachine.state.get();
				selectionStateMachine.selectCell(cell, CellSelectionType.Add);
				const stateAfter = selectionStateMachine.state.get();
				// The mousedown that preceded this click gave the editor DOM focus.
				// Move focus to the cell wrapper so no editor appears active during
				// multi-selection. Only do this when the state actually changed
				// (e.g., skip when shift-clicking the same cell you're editing).
				if (stateBefore !== stateAfter) {
					cellElement?.focus();
				}
				return;
			}

			const clickTarget = e.nativeEvent.target as HTMLElement;
			// If any of the element or its parents have the class
			// 'positron-cell-editor-monaco-widget' then don't run the select code as the editor
			// widget itself handles that logic
			const childOfEditor = clickTarget.closest('.positron-cell-editor-monaco-widget');
			if (childOfEditor) {
				return;
			}

			// If the clicked element is a link, let it do its thing.
			if (clickTarget.tagName === 'A') {
				return;
			}

			// If we're in editing mode and clicking outside the editor, exit editing mode
			if (selectionStatus === CellSelectionStatus.Editing) {
				selectionStateMachine.exitEditor();
				return;
			}

			// In single selection, clicking the already-selected cell's non-editor
			// area is a no-op. In multi-selection, collapse to single selection.
			if (selectionStatus === CellSelectionStatus.Selected) {
				const currentState = selectionStateMachine.state.get();
				if (currentState.type !== SelectionState.MultiSelection) {
					return;
				}
			}

			selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		}}
	>
		<CellProvider cell={cell}>
			<div className='positron-notebooks-cell-action-bar-container'>
				<NotebookCellActionBar cell={cell} />
			</div>
			<NotebookErrorBoundary
				componentName={`Cell[${cellTypeLower}]`}
				level='cell'
				logService={services.logService}
			>
				{children}
			</NotebookErrorBoundary>
			{/* Code cells render their tags inside the footer; markdown / raw cells */}
			{/* have no footer, so they show tags standalone at the cell bottom. */}
			{!cell.isCodeCell() && <CellTagsBar standalone cell={cell} />}
		</CellProvider>
		<ScreenReaderOnly>
			{announcement}
		</ScreenReaderOnly>
	</div>;
}
