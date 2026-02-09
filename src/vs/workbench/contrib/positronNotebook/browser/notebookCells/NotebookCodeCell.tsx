/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
import { CellOutputLeftActionMenu } from './CellOutputLeftActionMenu.js';
import { CodeCellStatusFooter } from './CodeCellStatusFooter.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';
import { Markdown } from './Markdown.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { useCellOutputContextMenu } from './useCellOutputContextMenu.js';
import { DataExplorerCellOutput } from './DataExplorerCellOutput.js';


interface CellOutputsSectionProps {
	cell: PositronNotebookCodeCell;
	outputs: NotebookCellOutputs[];
}

const CellOutputsSection = React.memo(function CellOutputsSection({ cell, outputs }: CellOutputsSectionProps) {
	const isCollapsed = useObservedValue(cell.outputIsCollapsed);
	const { showCellOutputContextMenu } = useCellOutputContextMenu(cell);
	const isSingleDataExplorer = outputs?.length === 1 &&
		outputs[0].parsed.type === 'dataExplorer';

	const handleShowHiddenOutput = () => {
		cell.expandOutput();
		/**
		 * When this handler is fired via a keyboard event (ex: Enter),
		 * the focus remains on the button that triggered this event.
		 * However, since expanding the output causes this button
		 * to be removed from the DOM, focus is lost. To maintain
		 * focus so keyboard nav/shortcuts still work, we refocus
		 * the cell container after expanding the output.
		 */
		cell.container?.focus();
	};

	const handleContextMenu = (event: React.MouseEvent) => {
		// Only show context menu if there are outputs
		if (outputs.length === 0) {
			return;
		}

		event.preventDefault();
		showCellOutputContextMenu({ x: event.clientX, y: event.clientY });
	};

	return (
		<div className={`positron-notebook-outputs-section ${outputs.length > 0 ? '' : 'no-outputs'} ${isSingleDataExplorer && !isCollapsed ? 'single-data-explorer' : ''}`}>
			<CellOutputLeftActionMenu cell={cell} />
			<section
				aria-label={localize('positron.notebook.cellOutput', 'Cell output')}
				className='positron-notebook-code-cell-outputs positron-notebook-cell-outputs'
				data-testid='cell-output'
				onContextMenu={handleContextMenu}
			>
				<div className='positron-notebook-code-cell-outputs-inner'>
					{isCollapsed
						? <Button
							ariaLabel={localize('positron.notebook.showHiddenOutput', 'Show hidden output')}
							className='show-hidden-output-button'
							onPressed={handleShowHiddenOutput}
						>
							{localize('positron.notebook.showHiddenOutput', 'Show hidden output')}
						</Button>
						: <>
							{outputs?.map((output) => (
								<CellOutput key={output.outputId} {...output} />
							))}
						</>
					}
				</div>
			</section>
		</div>
	);
}, (prevProps, nextProps) => {
	// Simple reference equality - outputs array is stable when nothing changes
	return prevProps.outputs === nextProps.outputs;
});

export const NotebookCodeCell = React.memo(function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const hasError = outputContents.some(o => o.parsed.type === 'error');

	return (
		<NotebookCellWrapper
			cell={cell}
		>
			<div className='positron-notebook-code-cell-contents'>
				<div className='positron-notebook-editor-section'>
					<CellLeftActionMenu cell={cell} />
					<div className='positron-notebook-editor-container'>
						<CellEditorMonacoWidget cell={cell} />
					</div>
					<CodeCellStatusFooter cell={cell} hasError={hasError} />
				</div>
				<CellOutputsSection cell={cell} outputs={outputContents} />
			</div>

		</NotebookCellWrapper>
	);
}, (prevProps, nextProps) => {
	// Cell objects are stable references - only rerender if cell reference changes
	return prevProps.cell === nextProps.cell;
});

const CellOutput = React.memo(function CellOutput(output: NotebookCellOutputs) {
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
		case 'html':
			return renderHtml(parsed.content);
		case 'markdown':
			return <Markdown content={parsed.content} />;
		case 'dataExplorer':
			return <DataExplorerCellOutput outputs={outputs} parsed={parsed} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{parsed.content}
			</div>;
	}
}, (prevProps, nextProps) => {
	// Reference equality on parsed is correct - new execution creates new parsed objects
	return prevProps.outputId === nextProps.outputId &&
		prevProps.parsed === nextProps.parsed;
});

