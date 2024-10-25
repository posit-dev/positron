/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { isParsedTextOutput } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from 'vs/nls';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { CellTextOutput } from './CellTextOutput';
import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';
import { NotebookCellWrapper } from './NotebookCellWrapper';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell';
import { NotebookHTMLContent } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookHTMLOutput';


export function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return <NotebookCellWrapper cell={cell}>
		<NotebookCellActionBar cell={cell}>
			<ActionButton
				ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
				onPressed={() => cell.run()} >
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</ActionButton>
		</NotebookCellActionBar>
		<div className='positron-notebook-code-cell-contents'>
			<CellEditorMonacoWidget cell={cell} />
			<div className='positron-notebook-cell-outputs'>
				{outputContents?.map((cellOutput) =>
					<CellOutput key={cellOutput.outputId} {...cellOutput} />
				)}
			</div>
		</div>
	</NotebookCellWrapper>;
}

function CellOutput(output: NotebookCellOutputs) {
	if (output.preloadMessageResult) {

		return <div>{output.preloadMessageResult.preloadMessageType === 'display' ? 'display' : 'preload'} message</div>;
	}

	const { parsed, outputId, outputs } = output;

	if (isParsedTextOutput(parsed)) {
		return <CellTextOutput {...parsed} />;
	}

	switch (parsed.type) {
		case 'interupt':
			return <div className='notebook-error'>
				{localize('cellExecutionKeyboardInterupt', 'Cell execution stopped due to keyboard interupt.')}
			</div>;
		case 'image':
			return <img src={parsed.dataUrl} alt='output image' />;
		case 'html':
			return <NotebookHTMLContent content={parsed.content} outputId={outputId} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Can\'t handle mime types "{0}" yet', outputs.map(o => o.mime).join(','))}
			</div>;
	}
}
