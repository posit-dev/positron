/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { VSBuffer } from 'vs/base/common/buffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from 'vs/nls';
import { NotebookCellSkeleton } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellSkeleton';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';


export function NodebookCodeCell({ cell }: { cell: IPositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return <NotebookCellSkeleton
		onDelete={() => cell.delete()}
		actionBarItems={
			<Button
				className='action-button'
				ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
				onPressed={() => cell.run()} >
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</Button>
		}
	>

		<CellEditorMonacoWidget cell={cell} />
		<div className='positron-notebook-cell-outputs'>
			{outputContents?.map((output) => <NotebookCellOutput key={output.outputId} cellOutput={output} />)}
		</div>
	</NotebookCellSkeleton>;
}

function NotebookCellOutput({ cellOutput }: { cellOutput: ICellOutput }) {

	const { outputs } = cellOutput;


	if (cellOutput instanceof NotebookCellOutputTextModel) {

		return <>
			{outputs.map(({ data, mime }, i) => <CellOutputContents key={i} data={data} mime={mime} />)}
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
