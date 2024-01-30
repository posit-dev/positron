/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellExecutionStatusCallback } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { gatherOutputContents } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';

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
	const [outputContents, setOutputContents] = React.useState(
		gatherOutputContents(cell)
	);

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
			setOutputContents(gatherOutputContents(cell));
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
		outputContents, runCell, executionStatus
	} = useRunCell({ cell, onRunCell, getCellExecutionStatus });

	const isRunning = executionStatus === 'running';
	return (
		<div className={`positron-notebook-cell ${executionStatus}`}
			data-status={executionStatus}
		>
			<PositronButton className='run-button' ariaLabel={isRunning ? 'stop execution' : 'Run cell'} onClick={runCell}>
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</PositronButton>
			<pre className='positron-notebook-cell-code'>{cell.getValue()}</pre>
			<div className='positron-notebook-cell-outputs'>
				{outputContents ? outputContents.map(({ content, id }) => <div key={id}>{content}</div>) : 'No outputs'}
			</div>
		</div>
	);
}

