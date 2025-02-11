/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCodeCell.css';

// React.
import React from 'react';

// Other dependencies.
import { NotebookCellOutputs } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { isParsedTextOutput } from '../getOutputContents.js';
import { useObservedValue } from '../useObservedValue.js';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { localize } from '../../../../../nls.js';
import { NotebookCellActionBar } from './NotebookCellActionBar.js';
import { CellTextOutput } from './CellTextOutput.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { PreloadMessageOutput } from './PreloadMessageOutput.js';

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
			return <img alt='output image' src={parsed.dataUrl} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Can\'t handle mime types "{0}" yet', outputs.map(o => o.mime).join(','))}
			</div>;
	}
}
