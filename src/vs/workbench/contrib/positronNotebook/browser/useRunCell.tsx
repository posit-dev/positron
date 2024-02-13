/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { ICellOutput, NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellExecutionStatusCallback } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';

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
export function useRunCell(opts: {
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

	React.useEffect(() => {
		const changeWatcher = cell.onDidChangeOutputs(() => {
			setOutputContents({ outputs: cell.outputs });
		});

		return changeWatcher.dispose;
	}, [cell]);

	return {
		outputContents,
		runCell,
		executionStatus,
	};
}
