/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./AddCellButton';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export function AddCellButton({ index }: { index: number }) {
	const notebookInstance = useNotebookInstance();

	return <div className='positron-add-cell-button'>
		<Button
			className='action action-button'
			ariaLabel={localize('addCell', 'Add cell')}
			onPressed={() => {
				notebookInstance.addCell(CellKind.Code, index);
			}}
		>
			<span className='action-label'>Add Cell</span>
			<div className='button-icon codicon codicon-plus' />
		</Button>
	</div>;
}
