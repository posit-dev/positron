/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCodeCell.css';

// React.
import React from 'react';

// Other dependencies.
import { NotebookCellOutputs } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { isParsedTextOutput } from '../getOutputContents.js';
import { useObservedValue } from '../useObservedValue.js';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { localize } from '../../../../../nls.js';
import { CellTextOutput } from './CellTextOutput.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { PreloadMessageOutput } from './PreloadMessageOutput.js';
import { CellLeftActionMenu } from './CellLeftActionMenu.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';


interface CellOutputsSectionProps {
	outputs: NotebookCellOutputs[];
}

function CellOutputsSection({ outputs }: CellOutputsSectionProps) {
	return (
		<div className={`positron-notebook-code-cell-outputs positron-notebook-cell-outputs ${outputs.length > 0 ? 'has-outputs' : 'no-outputs'}`} data-testid='cell-output'>
			{outputs?.map((output) => (
				<CellOutput key={output.outputId} {...output} />
			))}
		</div>
	);
}

export function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const hasError = outputContents.some(o => o.parsed.type === 'error');

	return (
		<NotebookCellWrapper
			cell={cell}
			hasError={hasError}
		>
			<div className='positron-notebook-code-cell-contents'>
				<div>
					<CellLeftActionMenu cell={cell} hasError={hasError} />
					<div className='positron-notebook-editor-container'>
						<CellEditorMonacoWidget cell={cell} />
					</div>
				</div>
				<CellOutputsSection outputs={outputContents} />
			</div>

		</NotebookCellWrapper>
	);
}

function CellOutput(output: NotebookCellOutputs) {
	if (output.preloadMessageResult) {
		return <PreloadMessageOutput preloadMessageResult={output.preloadMessageResult} />;
	}

	const { parsed } = output;

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
		case 'html':
			return renderHtml(parsed.content);
		case 'unknown':
			return <div className='unknown-mime-type'>
				{parsed.content}
			</div>;
	}
}
