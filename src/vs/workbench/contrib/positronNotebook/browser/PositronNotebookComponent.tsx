/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { CellExecutionStatusCallback, NotebookKernelObservable, NotebookViewModelObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { NotebookCell } from './NotebookCell';
import { useObservedValue } from './useObservedValue';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';

type CellsExecutionCallback = (cells?: Iterable<NotebookCellTextModel>) => Promise<void>;

export function PositronNotebookComponent(
	{ sizeObservable, inputObservable, viewModelObservable, kernelObservable, executeCells, getCellExecutionStatus }:
		{
			sizeObservable: ISettableObservable<ISize>;
			inputObservable: InputObservable;
			viewModelObservable: NotebookViewModelObservable;
			kernelObservable: NotebookKernelObservable;
			executeCells: CellsExecutionCallback;
			getCellExecutionStatus: CellExecutionStatusCallback;
		}
) {

	const size = useObservedValue(sizeObservable);
	const fileName = useObservedValue(inputObservable, input => input?.resource.path || 'No file name');
	const kernelId = useObservedValue(kernelObservable, kernel => kernel?.id || null);
	const notebookCells = useObservedValue(viewModelObservable, viewModel => viewModel?.notebookDocument?.cells || []);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
				<div>File: {fileName}</div>
				<div>{kernelId ? `Kernel: ${kernelId}` : `No Kernel Loaded`}</div>
				<div>Size: {size?.width} x {size?.height}</div>
			</div>
			<div className='positron-notebook-cells-container'>
				<div className='positron-notebook-cells-action-bar'>

					<PositronButton className='action run-button' ariaLabel={'Run cell'} onClick={() => executeCells()}>
						<span className='action-label'>Run all cells</span>
						<div className={`button-icon codicon ${'codicon-run'}`} />
					</PositronButton>

				</div>
				{notebookCells.map(cell => <NotebookCell
					key={cell.handle}
					onRunCell={() => executeCells([cell])}
					getCellExecutionStatus={getCellExecutionStatus}
					cell={cell} />)
				}
			</div>
		</div>
	);
}


