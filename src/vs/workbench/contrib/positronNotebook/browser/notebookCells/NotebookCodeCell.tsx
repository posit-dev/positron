/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCodeCell.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { NotebookCellOutputs, ParsedDataExplorerOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IOutputItemDto } from '../../../notebook/common/notebookCommon.js';
import { isParsedTextOutput, parseOutputData } from '../getOutputContents.js';
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
import { InlineDataExplorer } from './InlineDataExplorer.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY } from '../../common/positronNotebookConfig.js';


interface CellOutputsSectionProps {
	cell: PositronNotebookCodeCell;
	outputs: NotebookCellOutputs[];
}

function CellOutputsSection({ cell, outputs }: CellOutputsSectionProps) {
	const isCollapsed = useObservedValue(cell.outputIsCollapsed);
	const { showCellOutputContextMenu } = useCellOutputContextMenu(cell);

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
		<div className={`positron-notebook-outputs-section ${outputs.length > 0 ? '' : 'no-outputs'}`}>
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
}

export function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
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
}

/**
 * Wrapper component for data explorer outputs that handles fallback to HTML
 * when the data explorer comm is unavailable (e.g. after notebook reload).
 */
function DataExplorerCellOutput({ parsed, outputs }: {
	parsed: ParsedDataExplorerOutput;
	outputs: IOutputItemDto[];
}) {
	const services = PositronReactServices.services;
	const enabled = services.configurationService.getValue<boolean>(
		POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY
	) ?? true;

	const [useFallback, setUseFallback] = useState(false);

	if (!enabled || useFallback) {
		const htmlOutput = outputs.find(o => o.mime === 'text/html');
		if (htmlOutput) {
			const htmlParsed = parseOutputData(htmlOutput);
			if (htmlParsed.type === 'html') {
				return renderHtml(htmlParsed.content);
			}
		}
		if (!enabled) {
			return <div className='data-explorer-disabled'>
				{localize('dataExplorerDisabled', 'Inline data explorer is disabled. Enable it in settings to view data grids.')}
			</div>;
		}
	}

	return <InlineDataExplorer {...parsed} onFallback={() => setUseFallback(true)} />;
}
