/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellActionBar';

import * as React from 'react';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';


export function NotebookCellActionBar({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {

	return <div className='positron-notebooks-cell-action-bar'>
		{children}
		<Button
			className='action-button'
			ariaLabel={(() => localize('deleteCell', 'Delete cell'))()}
			onPressed={() => cell.delete()}
		>
			<div className='button-icon codicon codicon-trash' />
		</Button>
	</div>;
}
