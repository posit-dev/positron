/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { NotebookKernelObservable, NotebookViewModelObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { useObservedValue } from './useObservedValue';
import { gatherOutputContents } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';

type CellsExecutionCallback = (cells?: Iterable<NotebookCellTextModel>) => Promise<void>;
export function PositronNotebookComponent(
	{ message, sizeObservable, inputObservable, viewModelObservable, kernelObservable, executeCells }:
		{
			message: string;
			sizeObservable: ISettableObservable<ISize>;
			inputObservable: InputObservable;
			viewModelObservable: NotebookViewModelObservable;
			kernelObservable: NotebookKernelObservable;
			executeCells: CellsExecutionCallback;
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
				<h2>Notebook Cells</h2>
				{notebookCells.map(cell => <CellDisplay
					key={cell.handle}
					onRunCell={() => executeCells([cell])}
					cell={cell} />)
				}
			</div>
		</div>
	);
}


function CellDisplay({ cell, onRunCell }: {
	cell: NotebookCellTextModel;
	onRunCell: () => void;
}) {

	const outputContents = useCellOutputContents(cell);

	return (
		<div className='positron-notebook-cell'>
			<PositronButton className='run-button' ariaLabel='Run cell' onClick={onRunCell}>
				<div className={`button-icon codicon codicon-run`} />
			</PositronButton>
			<pre className='positron-notebook-cell-code'>{cell.getValue()}</pre>
			<div className='positron-notebook-cell-outputs'>
				{outputContents ? outputContents.map(({ content, id }) => <div key={id}>{content}</div>) : 'No outputs'}
			</div>
		</div>
	);
}


/**
 * Gather contents of output for a cell and update them as they change.
 * @param cell A notebook cell
 * @returns An array of output contents that are updated as the cell trigers the
 * `onDidChangeOutputs` event.
 */
function useCellOutputContents(cell: NotebookCellTextModel) {

	const [outputContents, setOutputContents] = React.useState(
		gatherOutputContents(cell)
	);

	React.useEffect(() => {
		const outputListener = cell.onDidChangeOutputs(() => {
			setOutputContents(gatherOutputContents(cell));
		});

		return () => outputListener.dispose();
	}, [cell]);

	return outputContents;
}
