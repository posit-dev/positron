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
import { PreloadMessageOutput } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/PreloadMessageOutput';

interface CellExecutionControlsProps {
	isRunning: boolean;
	onRun: () => void;
}

function CellExecutionControls({ isRunning, onRun }: CellExecutionControlsProps) {
	return (
		<ActionButton
			ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
			onPressed={onRun}
		>
			<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
		</ActionButton>
	);
}

interface CellOutputsSectionProps {
	outputs: NotebookCellOutputs[] | undefined;
}

function CellOutputsSection({ outputs = [] }: CellOutputsSectionProps) {
	return (
		<div className='positron-notebook-code-cell-outputs'>
			{outputs?.map((output) => (
				<CellOutput key={output.outputId} {...output} />
			))}
		</div>
	);
}

export function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return (
		<NotebookCellWrapper cell={cell}>
			<NotebookCellActionBar cell={cell}>
				<CellExecutionControls isRunning={isRunning} onRun={() => cell.run()} />
			</NotebookCellActionBar>
			<div className='positron-notebook-code-cell-contents'>
				<CellEditorMonacoWidget cell={cell} />
				<CellOutputsSection outputs={outputContents} />
			</div>
		</NotebookCellWrapper>
	);
}

function CellOutput(output: NotebookCellOutputs) {
	if (output.preloadMessageResult) {
		return <PreloadMessageOutput preloadMessageResult={output.preloadMessageResult} />;
	}

	const { parsed, outputs } = output;

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
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Can\'t handle mime types "{0}" yet', outputs.map(o => o.mime).join(','))}
			</div>;
	}
}
