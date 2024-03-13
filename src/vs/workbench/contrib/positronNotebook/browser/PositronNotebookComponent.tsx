/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { NotebookCell } from './NotebookCell';
import { AddCellButton } from './AddCellButton';
import { useObservedValue } from './useObservedValue';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
			</div>
			<div className='positron-notebook-cells-container'>
				<div className='positron-notebook-cells-action-bar'>
					<Button
						className='action action-button run-button'
						ariaLabel={localize('runAllCells', 'Run all cells')}
						onPressed={() => { notebookInstance.runAllCells(); }}
					>
						<span className='action-label'>
							{localize('runAllCells', 'Run all cells')}</span>
						<div className={`button-icon codicon ${'codicon-run'}`} />
					</Button>
				</div>
				<AddCellButton index={0} />
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.viewModel.handle} cell={cell} />
					<AddCellButton index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
		</div>
	);
}


