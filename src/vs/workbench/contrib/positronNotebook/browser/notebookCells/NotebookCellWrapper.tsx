/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellWrapper.css';
import './NotebookCellSelection.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType } from '../../../../services/positronNotebook/browser/selectionMachine.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useSelectionStatus } from './useSelectionStatus.js';
import { useObservedValue } from '../useObservedValue.js';
import { NotebookCellActionBar } from './NotebookCellActionBar.js';

export function NotebookCellWrapper({ cell, actionBarChildren, children }: {
	cell: IPositronNotebookCell;
	actionBarChildren?: React.ReactNode;
	children: React.ReactNode;
}) {
	const cellRef = React.useRef<HTMLDivElement>(null);
	const selectionStateMachine = useNotebookInstance().selectionStateMachine;
	const selectionStatus = useSelectionStatus(cell);
	const executionStatus = useObservedValue(cell.executionStatus);
	const [isHovered, setIsHovered] = useState(false);

	React.useEffect(() => {
		if (cellRef.current) {
			// Attach the container to the cell instance can properly control focus.
			cell.attachContainer(cellRef.current);
		}
	}, [cell, cellRef]);


	const cellType = cell.kind === CellKind.Code ? 'Code' : 'Markdown';
	const isSelected = selectionStatus === CellSelectionStatus.Selected || selectionStatus === CellSelectionStatus.Editing;

	return <div
		ref={cellRef}
		aria-label={localize('notebookCell', '{0} cell', cellType)}
		aria-selected={isSelected}
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionStatus}`}
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

			if (selectionStatus === CellSelectionStatus.Selected) {
				cell.deselect();
				return;
			}
			const addMode = e.shiftKey || e.ctrlKey || e.metaKey;
			selectionStateMachine.selectCell(cell, addMode ? CellSelectionType.Add : CellSelectionType.Normal);
		}}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<NotebookCellActionBar cell={cell} isHovered={isHovered}>
			{actionBarChildren}
		</NotebookCellActionBar>
		{children}
	</div>;
}
