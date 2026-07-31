/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SectionFoldButton.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { useObservedValue } from '../useObservedValue.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { IPositronNotebookMarkdownCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { CellSelectionType } from '../selectionMachine.js';

const collapseSectionLabel = localize('positronNotebook.cell.collapseSection', "Collapse Section");
const expandSectionLabel = localize('positronNotebook.cell.expandSection', "Expand Section");

interface SectionFoldButtonProps {
	cell: IPositronNotebookMarkdownCell;
}

/**
 * Chevron in the left cell gutter of a markdown header cell that collapses or
 * expands the cells under the header. Renders nothing when the cell does not
 * head a foldable section.
 */
export function SectionFoldButton({ cell }: SectionFoldButtonProps) {
	const instance = useNotebookInstance();
	const sectionRanges = useObservedValue(instance.sectionFolding.sectionRanges);
	const collapsedHandles = useObservedValue(instance.sectionFolding.collapsedHandles);

	const range = sectionRanges.find(r => r.headerIndex === cell.index);
	if (!range) {
		return null;
	}

	const isCollapsed = collapsedHandles.has(cell.handle);
	const label = isCollapsed ? expandSectionLabel : collapseSectionLabel;

	const handleToggle = () => {
		instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		instance.sectionFolding.toggleSectionCollapsed(cell);
	};

	return (
		<div className='section-fold-button-container'>
			<ActionButton
				ariaExpanded={!isCollapsed}
				ariaLabel={label}
				className={isCollapsed ? 'section-fold-button collapsed' : 'section-fold-button'}
				hoverManager={instance.hoverManager}
				tooltip={label}
				onPressed={handleToggle}
			>
				<ThemeIcon
					className={isCollapsed ? 'fold-chevron collapsed' : 'fold-chevron'}
					icon={Codicon.chevronDown}
				/>
			</ActionButton>
		</div>
	);
}
