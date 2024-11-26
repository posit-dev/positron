/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import './AddCellButtons.css';

import * as React from 'react';
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { localize } from '../../../../nls.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { IconedButton } from './utilityComponents/IconedButton';

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();

	return <div className='positron-add-cell-buttons'>
		<AddCodeCellButton notebookInstance={notebookInstance} index={index} bordered />
		<AddMarkdownCellButton notebookInstance={notebookInstance} index={index} bordered />
	</div>;
}


export function AddCodeCellButton({ notebookInstance, index, bordered }: { notebookInstance: PositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newCodeCellshort', 'Code');
	const fullLabel = localize('newCodeCellLong', 'New Code Cell');
	return <IconedButton
		codicon='code'
		label={label}
		fullLabel={fullLabel}
		onClick={() => notebookInstance.addCell(CellKind.Code, index)}
		bordered={bordered}
	/>;

}


export function AddMarkdownCellButton({ notebookInstance, index, bordered }: { notebookInstance: PositronNotebookInstance; index: number; bordered?: boolean }) {

	const label = localize('newMarkdownCellShort', 'Markdown');
	const fullLabel = localize('newMarkdownCellLong', 'New Markdown Cell');
	return <IconedButton
		codicon='markdown'
		label={label}
		fullLabel={fullLabel}
		onClick={() => notebookInstance.addCell(CellKind.Markup, index)}
		bordered={bordered}
	/>;

}
