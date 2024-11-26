/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import './NotebookCellActionBar.css';

import * as React from 'react';
import { localize } from '../../../../../nls.js';
import { IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';


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
