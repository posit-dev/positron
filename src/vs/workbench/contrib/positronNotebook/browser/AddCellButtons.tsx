/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./AddCellButtons';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();

	return <div className='positron-add-cell-buttons'>
		<Button
			className='action action-button'
			ariaLabel={localize('addCodeCell', 'Add code cell')}
			onPressed={() => {
				notebookInstance.addCell(CellKind.Code, index);
			}}
		>
			<span className='action-label'>Code</span>
			<div className='button-icon codicon codicon-plus' />
		</Button>
		<Button
			className='action action-button'
			ariaLabel={localize('addMarkdownell', 'Add markdown cell')}
			onPressed={() => {
				notebookInstance.addCell(CellKind.Markup, index);
			}}
		>
			<span className='action-label'>Markdown</span>
			<div className='button-icon codicon codicon-plus' />
		</Button>
	</div>;
}
