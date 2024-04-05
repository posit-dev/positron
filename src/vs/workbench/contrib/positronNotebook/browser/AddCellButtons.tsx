/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./AddCellButtons';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

export function AddCellButtons({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();

	return <div className='positron-add-cell-buttons'>
		<AddCodeCellButton notebookInstance={notebookInstance} index={index} />
		<AddMarkdownCellButton notebookInstance={notebookInstance} index={index} />
	</div>;
}



export function AddCodeCellButton({ notebookInstance, index }: { notebookInstance: PositronNotebookInstance; index: number }) {

	return <Button
		className='action action-button'
		ariaLabel={(() => localize('addCodeCell', 'Add code cell'))()}
		onPressed={() => {
			notebookInstance.addCell(CellKind.Code, index);
		}}
	>
		{/* TODO: Replace with custom codicon */}
		<div className='button-icon codicon codicon-plus' />
		<span className='action-label'>{
			localize('newCodeCell', 'New Code Cell')
		}</span>
	</Button>;
}

export function AddMarkdownCellButton({ notebookInstance, index }: { notebookInstance: PositronNotebookInstance; index: number }) {

	return <Button
		className='action action-button'
		ariaLabel={(() => localize('addMarkdownell', 'Add markdown cell'))()}
		onPressed={() => {
			notebookInstance.addCell(CellKind.Markup, index);
		}}
	>
		{/* TODO: Replace with custom codicon */}
		<div className='button-icon codicon codicon-plus' />
		<span className='action-label'>
			{localize('newMarkdownCell', 'New Markdown Cell')}
		</span>
	</Button>;
}
