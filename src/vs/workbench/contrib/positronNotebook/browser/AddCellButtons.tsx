/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AddCellButtons.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { localize } from '../../../../nls.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { IconedButton } from './utilityComponents/IconedButton.js';

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();

	return <div className='positron-add-cell-buttons'>
		<AddCodeCellButton bordered index={index} notebookInstance={notebookInstance} />
		<AddMarkdownCellButton bordered index={index} notebookInstance={notebookInstance} />
	</div>;
}


export function AddCodeCellButton({ notebookInstance, index, bordered }: { notebookInstance: PositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newCodeCellshort', 'Code');
	const fullLabel = localize('newCodeCellLong', 'New Code Cell');
	return <IconedButton
		bordered={bordered}
		codicon='code'
		fullLabel={fullLabel}
		label={label}
		onClick={() => notebookInstance.addCell(CellKind.Code, index)}
	/>;

}


export function AddMarkdownCellButton({ notebookInstance, index, bordered }: { notebookInstance: PositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newMarkdownCellShort', 'Markdown');
	const fullLabel = localize('newMarkdownCellLong', 'New Markdown Cell');
	return <IconedButton
		bordered={bordered}
		codicon='markdown'
		fullLabel={fullLabel}
		label={label}
		onClick={() => notebookInstance.addCell(CellKind.Markup, index)}
	/>;

}
