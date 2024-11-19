/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { NotebookCellOutputs } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { isParsedTextOutput, parseOutputData } from '../getOutputContents.js';
import { useObservedValue } from '../useObservedValue.js';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from '../../../../../nls.js';
import { NotebookCellActionBar } from './NotebookCellActionBar.js';
import { CellTextOutput } from './CellTextOutput';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { NotebookCellWrapper } from './NotebookCellWrapper';
import { pickPreferredOutputItem, PositronNotebookCodeCell } from '../PositronNotebookCell.js';
import { NotebookHTMLContent } from './NotebookHTMLOutput.js';
import { useServices } from '../ServicesProvider.js';


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
					<CellOutput key={outputId} outputs={outputs} outputId={outputId} />
				)}
			</div>
		</div>
	</NotebookCellWrapper>;

}

function CellOutput({ outputs, outputId }: NotebookCellOutputs) {
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
			return <NotebookHTMLContent content={parsed.content} outputId={outputId} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Cant handle mime type "{0}" yet', preferredOutput.mime)}
			</div>;
	}
}
