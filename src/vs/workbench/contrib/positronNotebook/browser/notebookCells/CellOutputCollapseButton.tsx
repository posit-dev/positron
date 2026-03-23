/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputCollapseButton.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { useObservedValue } from '../useObservedValue.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { CellSelectionType } from '../selectionMachine.js';

const expandOutputLabel = localize('positronNotebook.cell.expandOutput', "Expand Output");
const collapseOutputLabel = localize('positronNotebook.cell.collapseOutput', "Collapse Output");

interface CellOutputCollapseButtonProps {
	cell: PositronNotebookCodeCell;
}

export function CellOutputCollapseButton({ cell }: CellOutputCollapseButtonProps) {
	const instance = useNotebookInstance();
	const isCollapsed = useObservedValue(cell.outputIsCollapsed);

	const label = isCollapsed ? expandOutputLabel : collapseOutputLabel;
	const icon = isCollapsed ? Codicon.chevronRight : Codicon.chevronDown;

	const handleToggle = () => {
		instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		cell.toggleOutputCollapse();
	};

	return (
		<div className='cell-output-collapse-button-container'>
			<ActionButton
				ariaLabel={label}
				className='cell-output-collapse-button'
				hoverManager={instance.hoverManager}
				tooltip={label}
				onPressed={handleToggle}
			>
				<ThemeIcon icon={icon} />
			</ActionButton>
		</div>
	);
}
