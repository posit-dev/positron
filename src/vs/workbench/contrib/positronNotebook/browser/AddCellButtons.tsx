/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./AddCellButtons';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { localize } from 'vs/nls';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
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
		codicon='positron-notebook-code-cell'
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
		codicon='positron-notebook-markdown-cell'
		label={label}
		fullLabel={fullLabel}
		onClick={() => notebookInstance.addCell(CellKind.Markup, index)}
		bordered={bordered}
	/>;

}
