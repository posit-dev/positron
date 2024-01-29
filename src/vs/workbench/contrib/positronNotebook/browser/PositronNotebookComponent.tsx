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
import { CellExecutionStatusCallback, NotebookKernelObservable, NotebookViewModelObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { useObservedValue } from './useObservedValue';
import { gatherOutputContents } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';

type CellsExecutionCallback = (cells?: Iterable<NotebookCellTextModel>) => Promise<void>;

export function PositronNotebookComponent(
	{ message, sizeObservable, inputObservable, viewModelObservable, kernelObservable, executeCells, getCellExecutionStatus }:
		{
			message: string;
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
				<h2>Notebook Cells</h2>
				{notebookCells.map(cell => <CellDisplay
					key={cell.handle}
					onRunCell={() => executeCells([cell])}
					getCellExecutionStatus={getCellExecutionStatus}
					cell={cell} />)
				}
			</div>
		</div>
	);
}


type ExecutionStateString = 'running' | 'pending' | 'unconfirmed' | 'idle';
function parseExecutionState(state?: NotebookCellExecutionState): ExecutionStateString {
	switch (state) {
		case NotebookCellExecutionState.Executing:
			return 'running';
		case NotebookCellExecutionState.Pending:
			return 'pending';
		case NotebookCellExecutionState.Unconfirmed:
			return 'unconfirmed';
		default:
			return 'idle';
	}
}

function useRunCell({ cell, onRunCell, getCellExecutionStatus }: {
	cell: NotebookCellTextModel;
	onRunCell: () => Promise<void>;
	getCellExecutionStatus: CellExecutionStatusCallback;
}) {

	const [executionStatus, setExecutionStatus] = React.useState<ExecutionStateString>('idle');

	const runCell = React.useCallback(() => {
		setExecutionStatus('running');
		onRunCell().then(() => {
			setExecutionStatus('idle');
		}).catch(() => {
			setExecutionStatus(parseExecutionState(getCellExecutionStatus(cell)?.state));
		});
	}, [onRunCell, getCellExecutionStatus, cell]);


	return {
		runCell,
		executionStatus,
	};
}

function CellDisplay({ cell, onRunCell, getCellExecutionStatus }: {
	cell: NotebookCellTextModel;
	onRunCell: () => Promise<void>;
	getCellExecutionStatus: CellExecutionStatusCallback;
}) {

	const outputContents = useCellOutputContents(cell);

	const {
		runCell,
		executionStatus
	} = useRunCell({ cell, onRunCell, getCellExecutionStatus });

	return (
		<div className='positron-notebook-cell'>
			<PositronButton className='run-button' ariaLabel='Run cell' onClick={runCell}>
				<div className={`button-icon codicon codicon-run`} />
			</PositronButton>
			<pre className='positron-notebook-cell-code'>{cell.getValue()}</pre>
			<div className='positron-notebook-cell-outputs'>
				{outputContents ? outputContents.map(({ content, id }) => <div key={id}>{content}</div>) : 'No outputs'}
			</div>
			<div className='execution-status'>Status: {executionStatus}</div>
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
