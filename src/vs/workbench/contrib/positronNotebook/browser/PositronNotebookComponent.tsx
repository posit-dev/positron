/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { AddCellButtons } from './AddCellButtons';
import { useObservedValue } from './useObservedValue';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { KernelStatusBadge } from './KernelStatusBadge';
import { NotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCell';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<Button
					className='action action-button run-button'
					ariaLabel={(() => localize('runAllCells', 'Run all cells'))()}
					onPressed={() => { notebookInstance.runAllCells(); }}
				>
					<div className='button-icon codicon codicon-run' />
					<span className='action-label'>
						{localize('runAllCells', 'Run all cells')}
					</span>
				</Button>
				<KernelStatusBadge />
			</div>
			<div className='positron-notebook-cells-container'>
				<AddCellButtons index={0} />
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.viewModel.handle} cell={cell} />
					<AddCellButtons index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
		</div>
	);
}


