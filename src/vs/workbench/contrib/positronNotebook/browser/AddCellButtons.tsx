/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AddCellButtons.css';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { localize } from '../../../../nls.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { IconedButton } from './utilityComponents/IconedButton.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { useDragState } from './notebookCells/SortableCellList.js';

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();
	const { dropIndicatorIndex, isDropNoOp } = useDragState();
	const isDropTarget = dropIndicatorIndex === index;
	const showIndicator = isDropTarget && !isDropNoOp;

	return <div className={positronClassNames(
		'positron-add-cell-buttons',
		{ 'drop-target': showIndicator },
	)}>
		{showIndicator && <div className='drag-drop-indicator' data-testid='drop-indicator' />}
		<AddCodeCellButton bordered index={index} notebookInstance={notebookInstance} />
		<AddMarkdownCellButton bordered index={index} notebookInstance={notebookInstance} />
	</div>;
}


export function AddCodeCellButton({ notebookInstance, index, bordered }: { notebookInstance: IPositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newCodeCellshort', 'Code');
	const fullLabel = localize('newCodeCellLong', 'New Code Cell');
	return <IconedButton
		bordered={bordered}
		fullLabel={fullLabel}
		hoverManager={notebookInstance.hoverManager}
		icon={Codicon.plus}
		label={label}
		onClick={() => notebookInstance.addCell(CellKind.Code, index, true)}
	/>;

}


export function AddMarkdownCellButton({ notebookInstance, index, bordered }: { notebookInstance: IPositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newMarkdownCellShort', 'Markdown');
	const fullLabel = localize('newMarkdownCellLong', 'New Markdown Cell');
	return <IconedButton
		bordered={bordered}
		fullLabel={fullLabel}
		hoverManager={notebookInstance.hoverManager}
		icon={Codicon.plus}
		label={label}
		onClick={() => notebookInstance.addCell(CellKind.Markup, index, true)}
	/>;

}
