/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { IPositronNotebookCodeCell, IPositronNotebookMarkupCell, isCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { NodebookCodeCell } from './NodebookCodeCell';
import { NotebookMarkupCell } from './NotebookMarkupCell';

/**
 * Logic for running a cell and handling its output.
 * @param opts.cell The `PositronNotebookCell` to render
 */
export function NotebookCell({ cell }: {
	cell: IPositronNotebookCodeCell | IPositronNotebookMarkupCell;
}) {
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return (
		<div className={`positron-notebook-cell ${executionStatus}`}
			data-status={executionStatus}
		>
			<div className='action-bar'>
				<Button
					className='action-button'
					ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
					onPressed={() => cell.run()} >
					<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
				</Button>
				<Button
					className='action-button'
					ariaLabel={localize('deleteCell', 'Delete cell')}
					onPressed={() => cell.delete()}
				>
					<div className='button-icon codicon codicon-trash' />
				</Button>
			</div>
			<div className='cell-contents'>
				{
					isCodeCell(cell) ?
						<NodebookCodeCell cell={cell} /> :
						<NotebookMarkupCell cell={cell} />
				}
			</div>
		</div >
	);
}



