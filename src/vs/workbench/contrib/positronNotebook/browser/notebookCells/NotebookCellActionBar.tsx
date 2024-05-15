/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellActionBar';

import * as React from 'react';
import { localize } from 'vs/nls';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';


export function NotebookCellActionBar({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {

	return <div className='positron-notebooks-cell-action-bar'>
		{children}
		<ActionButton
			ariaLabel={(() => localize('deleteCell', 'Delete cell'))()}
			onPressed={() => cell.delete()}
		>
			<div className='button-icon codicon codicon-trash' />
		</ActionButton>
	</div>;
}
