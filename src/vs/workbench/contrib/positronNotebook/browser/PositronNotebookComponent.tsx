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
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';

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
	console.log('Positron Notebook Component', { message, size: sizeObservable });

	const size = useObservedValue(sizeObservable);
	const fileName = useObservedValue(inputObservable, input => input?.resource.path || 'No file name');
	const kernelId = useObservedValue(kernelObservable, kernel => kernel?.id || null);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
				<div>File: {fileName}</div>
				<div>{kernelId ? `Kernel: ${kernelId}` : `No Kernel Loaded`}</div>
				<div>Size: {size?.width} x {size?.height}</div>
			</div>
			<CellsDisplay viewModelObservable={viewModelObservable} executeCells={executeCells} />
		</div>
	);
}

function CellsDisplay({ viewModelObservable, executeCells }: {
	viewModelObservable: NotebookViewModelObservable;
	executeCells: CellsExecutionCallback;
}) {
	const notebookModel = useObservedValue(viewModelObservable, viewModel => viewModel?.notebookDocument);

	if (notebookModel?.cells.length === 0) {
		return <div>No cells</div>;
	}


	return (
		<div className='positron-notebook-cells-container'>
			<h2>Notebook Cells</h2>
			{notebookModel?.cells.map(cell => <CellDisplay
				key={cell.handle}
				onRunCell={() =>
					executeCells([cell])
				}
				cell={cell}></CellDisplay>)
			}
		</div>
	);
}

function CellDisplay({ cell, onRunCell }: {
	cell: NotebookCellTextModel;
	onRunCell: () => void;
}) {
	const [outputs, setOutputs] = React.useState(cell.outputs);

	React.useEffect(() => {
		const outputListener = cell.onDidChangeOutputs(() => {
			console.log('Cell outputs changed', cell.outputs);
			setOutputs(cell.outputs);
			console.log({ cell });

		});

		return () => {
			outputListener.dispose();
		};
	}, [cell]);

	const label = 'Run cell';
	return (
		<div className='positron-notebook-cell'>
			<PositronButton className='run-button' ariaLabel={label} onClick={
				() => {
					console.log('Run this cell please', cell.getValue());
					onRunCell();
				}
			}>
				<div className={`button-icon codicon codicon-run`} />
			</PositronButton>
			<pre className='positron-notebook-cell-code'>{cell.getValue()}</pre>
			<div className='positron-notebook-cell-outputs'>
				{outputs ? outputs.map((output) => <OutputDisplay key={output.outputId} output={output} />) : 'No outputs'}
			</div>
		</div>
	);
}

function OutputDisplay({ output }: { output: ICellOutput }) {

	if (output instanceof NotebookCellOutputTextModel) {
		return <pre>{getTextOutputContents(output)}</pre>;
	}

	return <div>Cant handle output type yet: OutputId: {output.outputId}</div>;
}


function getTextOutputContents(output: NotebookCellOutputTextModel): string {
	// return output.items.map(item => item.text).join('\n');

	return output.outputs.map(({ data }) => data.toString()).join('\n');

}



