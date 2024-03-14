/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { VSBuffer } from 'vs/base/common/buffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { useCellEditorWidget } from './useCellEditorWidget';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * Logic for running a cell and handling its output.
 * @param opts.cell The `PositronNotebookCell` to render
 */
export function NotebookCell(opts: {
	cell: PositronNotebookCell;
}) {

	const { editorPartRef, editorContainerRef } = useCellEditorWidget(opts);

	const executionStatus = useObservedValue(opts.cell.executionStatus);
	const outputContents = useObservedValue(opts.cell.outputs);

	const isRunning = executionStatus === 'running';
	return (
		<div className={`positron-notebook-cell ${executionStatus}`}
			data-status={executionStatus}
		>
			<div className='action-bar'>
				<Button
					className='action-button'
					ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
					onPressed={() => opts.cell.run()} >
					<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
				</Button>
				<Button
					className='action-button'
					ariaLabel={localize('deleteCell', 'Delete cell')}
					onPressed={() => opts.cell.delete()}
				>
					<div className='button-icon codicon codicon-trash' />
				</Button>
			</div>
			<div className='cell-contents'>
				<div ref={editorPartRef}>
					<div ref={editorContainerRef} className='positron-monaco-editor-container'></div>
				</div>
				<div className='positron-notebook-cell-outputs'>
					{
						outputContents?.map((output) =>
							<NotebookCellOutput key={output.outputId} cellOutput={output} />)
					}
				</div>
			</div>
		</div >
	);
}



function NotebookCellOutput({ cellOutput }: { cellOutput: ICellOutput }) {

	const { outputs } = cellOutput;


	if (cellOutput instanceof NotebookCellOutputTextModel) {

		return <>
			{
				outputs.map(({ data, mime }, i) => <CellOutputContents key={i} data={data} mime={mime} />)
			}
		</>;
	}

	return <div>
		{localize('cellExecutionUnknownOutputType', 'Can not handle output type: OutputId: {0}', cellOutput.outputId)}
	</div>;


}


function CellOutputContents(output: { data: VSBuffer; mime: string }) {

	const parsed = parseOutputData(output);

	switch (parsed.type) {
		case 'stdout':
			return <div className='notebook-stdout'>{parsed.content}</div>;
		case 'error':
		case 'stderr':
			return <div className='notebook-stderr'>{parsed.content}</div>;
		case 'interupt':
			return <div className='notebook-error'>
				{localize('cellExecutionKeyboardInterupt', 'Cell execution stopped due to keyboard interupt.')}
			</div>;
		case 'text':
			return <div className='notebook-text'>{parsed.content}</div>;
		case 'image':
			return <img src={parsed.dataUrl} alt='output image' />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Cant handle mime type "{0}" yet', output.mime)}
			</div>;
	}

}

