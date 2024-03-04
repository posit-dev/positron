/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { NotebookCell } from './NotebookCell';
import { useObservedValue } from './useObservedValue';


export function PositronNotebookComponent(
	{
		sizeObservable,
	}:
		{
			sizeObservable: ISettableObservable<ISize>;
		}
) {
	const notebookInstance = useNotebookInstance();

	const size = useObservedValue(sizeObservable);
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
				<div>Size: {size?.width} x {size?.height}</div>
			</div>
			<div className='positron-notebook-cells-container'>
				<div className='positron-notebook-cells-action-bar'>

					<PositronButton className='action run-button' ariaLabel={'Run cell'} onPressed={() => {
						notebookInstance.runAllCells();
					}}>
						<span className='action-label'>Run all cells</span>
						<div className={`button-icon codicon ${'codicon-run'}`} />
					</PositronButton>
				</div>
				{notebookCells?.length ? notebookCells?.map(cell => <NotebookCell
					key={cell.viewModel.handle}
					sizeObservable={sizeObservable}
					cell={cell} />) : <div>No cells</div>
				}
			</div>
		</div>
	);
}


