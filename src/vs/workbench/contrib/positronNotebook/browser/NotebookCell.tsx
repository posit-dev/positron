/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { VSBuffer } from 'vs/base/common/buffer';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellExecutionStatusCallback } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useCellEditorWidget } from './useCellEditorWidget';
import { useRunCell } from './useRunCell';

export function NotebookCell({ cell, onRunCell, getCellExecutionStatus }: {
	cell: ICellViewModel;
	onRunCell: () => Promise<void>;
	getCellExecutionStatus: CellExecutionStatusCallback;
}) {

	const {
		outputContents, runCell, executionStatus,
	} = useRunCell({ cell, onRunCell, getCellExecutionStatus });



	const isRunning = executionStatus === 'running';
	return (
		<div className={`positron-notebook-cell ${executionStatus}`}
			data-status={executionStatus}
		>
			<PositronButton className='run-button' ariaLabel={isRunning ? 'stop execution' : 'Run cell'} onPressed={runCell}>
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</PositronButton>
			<NotebookCellEditor cell={cell} />
			<div className='positron-notebook-cell-outputs'>
				{
					outputContents.outputs.map((output) =>
						<NotebookCellOutput key={output.outputId} cellOutput={output} />)
				}
			</div>
		</div >
	);
}

function NotebookCellEditor({ cell }: { cell: ICellViewModel }) {

	const { editorPartRef, editorContainerRef } = useCellEditorWidget(cell);

	return <div ref={editorPartRef}>
		<pre className='positron-notebook-cell-code'>{cell.getText()}</pre>
		<div ref={editorContainerRef} className='positron-monaco-editor-container'></div>
	</div>;

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

