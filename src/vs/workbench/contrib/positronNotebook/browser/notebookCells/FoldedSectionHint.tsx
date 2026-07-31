/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './FoldedSectionHint.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useObservedValue } from '../useObservedValue.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { IPositronNotebookMarkdownCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';

interface FoldedSectionHintProps {
	cell: IPositronNotebookMarkdownCell;
}

/**
 * Clickable "N cells hidden" hint shown at the bottom of a collapsed markdown
 * header cell. Renders nothing when the cell's section is not collapsed.
 */
export function FoldedSectionHint({ cell }: FoldedSectionHintProps) {
	const instance = useNotebookInstance();
	const sectionRanges = useObservedValue(instance.sectionFolding.sectionRanges);
	const collapsedHandles = useObservedValue(instance.sectionFolding.collapsedHandles);

	const range = sectionRanges.find(r => r.headerIndex === cell.index);
	if (!range || !collapsedHandles.has(cell.handle)) {
		return null;
	}

	const hiddenCount = range.endIndex - range.headerIndex;
	const label = hiddenCount === 1
		? localize('positronNotebook.cell.oneCellHidden', "1 cell hidden")
		: localize('positronNotebook.cell.cellsHidden', "{0} cells hidden", hiddenCount);

	const handleExpand = () => {
		instance.sectionFolding.setSectionCollapsed(cell, false);
	};

	return (
		<Button
			ariaLabel={label}
			className='folded-section-hint'
			hoverManager={instance.hoverManager}
			tooltip={localize('positronNotebook.cell.expandSection', "Expand Section")}
			onPressed={handleExpand}
		>
			{label}
		</Button>
	);
}
