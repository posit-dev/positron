/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { VSBuffer } from 'vs/base/common/buffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { isParsedTextOutput, parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { ANSIOutput } from 'vs/base/common/ansiOutput';
import { OutputLines } from 'vs/workbench/browser/positronAnsiRenderer/outputLines';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';


export function NodebookCodeCell({ cell }: { cell: IPositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return <div className='positron-notebook-cell'>
		<NotebookCellActionBar cell={cell}>
			<Button
				className='action-button'
				ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
				onPressed={() => cell.run()} >
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</Button>
		</NotebookCellActionBar>
		<div className='cell-contents'>
			<CellEditorMonacoWidget cell={cell} />
			<div className='positron-notebook-cell-outputs'>
				{outputContents?.map((output) => <NotebookCellOutput key={output.outputId} cellOutput={output} />)}
			</div>
		</div>
	</div>;

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

function CellTextOutput({ output }: { output: string }) {

	const { openerService, notificationService } = useServices();

	const processedAnsi = ANSIOutput.processOutput(output);

	return <OutputLines
		outputLines={processedAnsi}
		openerService={openerService}
		notificationService={notificationService}
	/>;
}

function CellOutputContents(output: { data: VSBuffer; mime: string }) {

	const parsed = parseOutputData(output);

	if (isParsedTextOutput(parsed)) {
		return <div className={`notebook-${parsed.type}`}>
			<CellTextOutput output={parsed.content} />
		</div>;
	}

	switch (parsed.type) {
		case 'interupt':
			return <div className='notebook-error'>
				{localize('cellExecutionKeyboardInterupt', 'Cell execution stopped due to keyboard interupt.')}
			</div>;
		case 'image':
			return <img src={parsed.dataUrl} alt='output image' />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Cant handle mime type "{0}" yet', output.mime)}
			</div>;
	}

}
