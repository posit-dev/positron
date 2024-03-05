/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { NotebookCell } from './NotebookCell';
import { useObservedValue } from './useObservedValue';


export function PositronNotebookComponent(

) {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
			</div>
			<div className='positron-notebook-cells-container'>
				<div className='positron-notebook-cells-action-bar'>
					<PositronButton className='action action-button run-button' ariaLabel='Run all cells' onPressed={() => {
						notebookInstance.runAllCells();
					}}>
						<span className='action-label'>Run all cells</span>
						<div className={`button-icon codicon ${'codicon-run'}`} />
					</PositronButton>
				</div>
				<PositronButton className='action action-button add-cell' ariaLabel='Add cell' onPressed={() => {
					notebookInstance.addCell('code', 0);
				}}>
					<span className='action-label'>Add Cell</span>
					<div className={`button-icon codicon ${'codicon-plus'}`} />
				</PositronButton>
				{notebookCells?.length ? notebookCells?.map(cell => <NotebookCell
					key={cell.viewModel.handle}
					cell={cell} />) : <div>No cells</div>
				}
			</div>
		</div>
	);
}


