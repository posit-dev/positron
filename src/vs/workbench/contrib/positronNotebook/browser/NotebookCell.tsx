/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { VSBuffer } from 'vs/base/common/buffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { ICellOutput, NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellExecutionStatusCallback } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';

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


/**
 * Logic for running a cell and handling its output.
 * @param opts
 * @param opts.cell The cell to run
 * @param opts.onRunCell A callback to run the cell
 * @param opts.getCellExecutionStatus A callback to get the execution status of the cell
 * @returns An object with the output contents and a function to run the cell.
 */
function useRunCell(opts: {
	cell: NotebookCellTextModel;
	onRunCell: () => Promise<void>;
	getCellExecutionStatus: CellExecutionStatusCallback;
}) {
	const { cell, onRunCell, getCellExecutionStatus } = opts;

	const [executionStatus, setExecutionStatus] = React.useState<ExecutionStateString>('idle');
	// By putting the outputContents into an object, we're ensuring that everytime it updates we
	// are able to get a new reference to the object, which will cause the component to re-render.
	// By default the outputs of the cell is referentially stable and thus react will not rerender
	// the component when the outputs change.
	const [outputContents, setOutputContents] = React.useState<{ outputs: ICellOutput[] }>({ outputs: cell.outputs });

	const runCell = React.useCallback(() => {
		setExecutionStatus('running');
		onRunCell()
			.then(() => {
				setExecutionStatus('idle');
			}).catch(() => {
				setExecutionStatus(parseExecutionState(getCellExecutionStatus(cell)?.state));
			});
	}, [onRunCell, getCellExecutionStatus, cell]);

	React.useEffect(() =>
		cell.onDidChangeOutputs(() => {
			setOutputContents({ outputs: cell.outputs });
		}).dispose, [cell]);

	return {
		outputContents,
		runCell,
		executionStatus,
	};
}


export function NotebookCell({ cell, onRunCell, getCellExecutionStatus }: {
	cell: NotebookCellTextModel;
	onRunCell: () => Promise<void>;
	getCellExecutionStatus: CellExecutionStatusCallback;
}) {

	const {
		outputContents, runCell, executionStatus,
	} = useRunCell({ cell, onRunCell, getCellExecutionStatus });

	const { instantiationService } = useServices();
	console.log('instantiationService', instantiationService);

	const isRunning = executionStatus === 'running';
	return (
		<div className={`positron-notebook-cell ${executionStatus}`}
			data-status={executionStatus}
		>
			<PositronButton className='run-button' ariaLabel={isRunning ? 'stop execution' : 'Run cell'} onPressed={runCell}>
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</PositronButton>
			<pre className='positron-notebook-cell-code'>{cell.getValue()}</pre>
			<div className='positron-notebook-cell-outputs'>
				{
					outputContents.outputs.map((output) =>
						<NotebookCellOutput key={output.outputId} cellOutput={output} />)
				}
			</div>
		</div >
	);
}

function NotebookCellOutput({ cellOutput }: { cellOutput: ICellOutput }) {

	const { outputs } = cellOutput;

	if (!(cellOutput instanceof NotebookCellOutputTextModel)) {
		return <div>Cant handle output type yet: OutputId: ${cellOutput.outputId}</div>;
	}

	return <>
		{
			outputs.map(({ data, mime }, i) => <CellOutputContents key={i} data={data} mime={mime} />)
		}
	</>;
}


function CellOutputContents(output: { data: VSBuffer; mime: string }) {

	const parsed = parseOutputData(output);

	switch (parsed.type) {
		case 'stdout':
			return <div className='notebook-stdout'>{parsed.content}</div>;
		case 'stderr':
			return <div className='notebook-stderr'>{parsed.content}</div>;
		case 'interupt':
			return <div className='notebook-error'>Cell execution stopped due to keyboard interupt.</div>;
		case 'text':
			return <div className='notebook-text'>{parsed.content}</div>;
		case 'unknown':
			return <div className='unknown-mime-type'>Cant handle mime type &quot;{output.mime}&quot; yet</div>;
	}

}

