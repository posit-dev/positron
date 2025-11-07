/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellWrapper.css';
import './NotebookCellSelection.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType } from '../selectionMachine.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useObservedValue } from '../useObservedValue.js';
import { NotebookCellActionBar } from './NotebookCellActionBar.js';
import { useCellContextKeys } from './useCellContextKeys.js';
import { CellScopedContextKeyServiceProvider } from './CellContextKeyServiceProvider.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';

export function NotebookCellWrapper({ cell, children, hasError }: {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
	hasError?: boolean;
}) {
	const cellRef = React.useRef<HTMLDivElement>(null);
	// Track the cell element in state so changes trigger re-renders and context key updates
	const [cellElement, setCellElement] = React.useState<HTMLDivElement | null>(null);
	const notebookInstance = useNotebookInstance();
	const selectionStateMachine = notebookInstance.selectionStateMachine;
	const selectionStatus = useObservedValue(cell.selectionStatus);
	const executionStatus = useObservedValue(cell.executionStatus);

	React.useEffect(() => {
		if (cellRef.current) {
			// Attach the container so the cell instance can properly control focus.
			cell.attachContainer(cellRef.current);
			// Update state to trigger context key setup
			setCellElement(cellRef.current);
		}
	}, [cell, cellRef]);

	// Focus management based on selection status
	React.useLayoutEffect(() => {
		if (!cellRef.current) {
			return;
		}

		const status = selectionStatus;

		if (status === CellSelectionStatus.Selected) {
			// Cell is selected (not editing) - focus the cell container
			cellRef.current.focus();
		}
	}, [selectionStatus, cellRef]);

	// Manage context keys for this cell
	const scopedContextKeyService = useCellContextKeys(cell, cellElement, notebookInstance);

	const cellType = cell.kind === CellKind.Code ? 'Code' : 'Markdown';
	const isSelected = selectionStatus === CellSelectionStatus.Selected || selectionStatus === CellSelectionStatus.Editing;

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

		// Close any open markdown cell editors when clicking on a different cell
		// This must happen before any early returns to ensure markdown cell editors
		// always close when clicking outside them
		for (const otherCell of cells) {
			if (otherCell !== cell && otherCell.isMarkdownCell() && otherCell.editorShown.get()) {
				otherCell.toggleEditor();
			}
		}
	}, [selectionStatus, cell, notebookInstance]);

	return <div
		ref={cellRef}
		aria-label={localize('notebookCell', '{0} cell', cellType)}
		aria-selected={isSelected}
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionStatus}`}
		data-has-error={hasError}
		data-is-running={executionStatus === 'running'}
		data-testid='notebook-cell'
		role='article'
		tabIndex={0}
		onClick={(e) => {
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

			// If already selected, do nothing - maintain selection invariant
			if (selectionStatus === CellSelectionStatus.Selected) {
				return;
			}

			const addMode = e.shiftKey || e.ctrlKey || e.metaKey;
			selectionStateMachine.selectCell(cell, addMode ? CellSelectionType.Add : CellSelectionType.Normal);
		}}
	>
		<CellScopedContextKeyServiceProvider service={scopedContextKeyService}>
			<NotebookCellActionBar cell={cell} />
			{children}
		</CellScopedContextKeyServiceProvider>
		<ScreenReaderOnly>
			{announcement}
		</ScreenReaderOnly>
	</div>;
}
