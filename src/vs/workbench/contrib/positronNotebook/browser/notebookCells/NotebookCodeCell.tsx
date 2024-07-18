/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { isParsedTextOutput, parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from 'vs/nls';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { CellTextOutput } from './CellTextOutput';
import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';
import { NotebookCellWrapper } from './NotebookCellWrapper';
import { pickPreferredOutputItem, PositronNotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { NotebookHTMLContent } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookHTMLOutput';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';


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
		<div className='cell-contents'>
			<CellEditorMonacoWidget cell={cell} />
			<div className='positron-notebook-cell-outputs'>
				{outputContents?.map(({ outputs, outputId }) =>
					<CellOutput key={outputId} outputs={outputs} />
				)}
			</div>
		</div>
	</NotebookCellWrapper>;

}

function CellOutput({ outputs }: Pick<NotebookCellOutputs, 'outputs'>) {
	const services = useServices();
	const preferredOutput = pickPreferredOutputItem(outputs, services.logService.warn);

	if (!preferredOutput) {
		return null;
	}

	const parsed = parseOutputData(preferredOutput);

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
			return <NotebookHTMLContent content={parsed.content} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Cant handle mime type "{0}" yet', preferredOutput.mime)}
			</div>;
	}
}
