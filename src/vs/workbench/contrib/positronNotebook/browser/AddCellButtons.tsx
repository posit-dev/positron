/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AddCellButtons.css';

// React.
import { useCallback, useState } from 'react';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { localize } from '../../../../nls.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { IconedButton } from './utilityComponents/IconedButton.js';
import { SplitButton } from './utilityComponents/SplitButton.js';
import { Icon } from '../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IAction } from '../../../../base/common/actions.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useDragState } from './notebookCells/SortableCellList.js';

/**
 * The cell types offered by the add-cell split button. A "raw" cell is a code
 * cell whose language is set to `raw`, matching how the notebook model and the
 * "Convert to Raw" command represent raw cells.
 */
type AddableCellType = 'code' | 'raw';

interface CellTypeSpec {
	readonly language?: string;
	readonly label: string;
	readonly fullLabel: string;
}

const CELL_TYPE_SPECS: Record<AddableCellType, CellTypeSpec> = {
	code: { label: localize('newCodeCellshort', 'Code'), fullLabel: localize('newCodeCellLong', 'New Code Cell') },
	raw: { language: 'raw', label: localize('newRawCellShort', 'Raw'), fullLabel: localize('newRawCellLong', 'New Raw Cell') },
};

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();
	const { dropIndicatorIndex, isDropNoOp } = useDragState();
	const isDropTarget = dropIndicatorIndex === index;
	const showIndicator = isDropTarget && !isDropNoOp;

	// The group hides itself when focus/hover leave it. The split button's
	// dropdown menu renders at the body level, so opening it would otherwise make
	// the group vanish mid-interaction; keep it visible while the menu is open.
	const [menuOpen, setMenuOpen] = useState(false);

	return <div className={positronClassNames(
		'positron-add-cell-buttons',
		{ 'drop-target': showIndicator },
		{ 'menu-open': menuOpen },
	)}>
		{showIndicator && <div className='drag-drop-indicator' data-testid='drop-indicator' />}
		<div className='add-cell-buttons-group'>
			<AddCellSplitButton index={index} notebookInstance={notebookInstance} onMenuOpenChange={setMenuOpen} />
			<AddMarkdownCellButton bordered index={index} notebookInstance={notebookInstance} />
		</div>
	</div>;
}

/**
 * Split button that adds a cell. The main action adds a Code cell; the dropdown
 * offers Code and Raw. Markdown has its own dedicated button
 * (AddMarkdownCellButton), so it stays out of this menu.
 */
export function AddCellSplitButton({ notebookInstance, index, onMenuOpenChange }: { notebookInstance: IPositronNotebookInstance; index: number; onMenuOpenChange?: (open: boolean) => void }) {
	const { contextMenuService } = usePositronReactServicesContext();

	const insertCell = useCallback((type: AddableCellType) => {
		// Both code and raw cells are CellKind.Code; raw differs only by language.
		// enterEditMode === true focuses the new cell.
		notebookInstance.addCell(CellKind.Code, index, true, '', CELL_TYPE_SPECS[type].language);
	}, [notebookInstance, index]);

	const dropdownActions: IAction[] = (['code', 'raw'] as const).map(type => ({
		id: `positronNotebook.addCell.${type}`,
		label: CELL_TYPE_SPECS[type].label,
		tooltip: CELL_TYPE_SPECS[type].fullLabel,
		class: undefined,
		enabled: true,
		run: () => insertCell(type),
	}));

	const code = CELL_TYPE_SPECS.code;

	return <SplitButton
		ariaLabel={code.fullLabel}
		className='add-cell-split-button'
		contextMenuService={contextMenuService}
		dropdownActions={dropdownActions}
		dropdownTooltip={localize('newCellDropdownTooltip', "Choose cell type")}
		onMainAction={() => insertCell('code')}
		onMenuOpenChange={onMenuOpenChange}
	>
		<Icon className='button-icon' icon={Codicon.addSmall} />
		<span className='action-label'>{code.label}</span>
	</SplitButton>;
}

export function AddMarkdownCellButton({ notebookInstance, index, bordered }: { notebookInstance: IPositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newMarkdownCellShort', 'Markdown');
	const fullLabel = localize('newMarkdownCellLong', 'New Markdown Cell');
	return <IconedButton
		bordered={bordered}
		fullLabel={fullLabel}
		hoverManager={notebookInstance.hoverManager}
		icon={Codicon.addSmall}
		label={label}
		onClick={() => notebookInstance.addCell(CellKind.Markup, index, true)}
	/>;

}
