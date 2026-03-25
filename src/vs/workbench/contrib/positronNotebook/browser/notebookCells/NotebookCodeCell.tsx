/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCodeCell.css';

// React.
import React, { useMemo } from 'react';

// Other dependencies.
import { NotebookCellOutputs } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { isParsedTextOutput } from '../getOutputContents.js';
import { useObservedValue } from '../useObservedValue.js';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { CellTextOutput } from './CellTextOutput.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { PreloadMessageOutput } from './PreloadMessageOutput.js';
import { CellLeftActionMenu } from './CellLeftActionMenu.js';
import { CellOutputCollapseButton } from './CellOutputCollapseButton.js';
import { useNotebookInstance, useNotebookOptions } from '../NotebookInstanceProvider.js';
import { CodeCellStatusFooter } from './CodeCellStatusFooter.js';
import { isHTMLElement } from '../../../../../base/browser/dom.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';
import { Markdown } from './Markdown.js';
import { useCellContextMenu } from './useCellContextMenu.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { DataExplorerCellOutput } from './DataExplorerCellOutput.js';
import { NotebookErrorBoundary } from '../NotebookErrorBoundary.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED, POSITRON_NOTEBOOK_CELL_OUTPUT_OVERFLOWS } from '../ContextKeysManager.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { useScrollingIndicator } from './useScrollingIndicator.js';
import { CellOutputActionBar } from './CellOutputActionBar.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

const expandOutputTooltip = localize('positron.notebook.expandOutput', "Click to Expand Output");
const outputCollapsedLabel = localize('positron.notebook.outputCollapsed', 'Output collapsed');

interface CellOutputsSectionProps {
	cell: PositronNotebookCodeCell;
	outputs: NotebookCellOutputs[];
}

const CellOutputsSection = React.memo(function CellOutputsSection({ cell, outputs }: CellOutputsSectionProps) {
	const services = usePositronReactServicesContext();
	const isCollapsed = useObservedValue(cell.outputIsCollapsed);
	const perCellScrolling = useObservedValue(cell.outputScrolling);
	const contextKeyService = useCellScopedContextKeyService();
	const outputOverflowsKey = useMemo(
		() => contextKeyService ? POSITRON_NOTEBOOK_CELL_OUTPUT_OVERFLOWS.bindTo(contextKeyService) : undefined,
		[contextKeyService]
	);
	const outputImageTargeted = useMemo(
		() => contextKeyService ? POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.bindTo(contextKeyService) : undefined,
		[contextKeyService]
	);
	const notebookOptions = useNotebookOptions();
	const layout = notebookOptions.getLayoutConfiguration();
	const outputsInnerRef = React.useRef<HTMLDivElement>(null);
	useScrollingIndicator(outputsInnerRef);

	// Per-cell scrolling override takes precedence over global setting.
	const outputScrolling = perCellScrolling ?? layout.outputScrolling;

	// Update the output overflow context key.
	React.useEffect(() => {
		if (!outputOverflowsKey) { return; }
		const hasOverflowingOutput = outputs.some(o =>
			isParsedTextOutput(o.parsed) && o.parsed.content.trimEnd().split('\n').length > layout.outputLineLimit
		);
		outputOverflowsKey.set(hasOverflowingOutput);
	}, [outputs, layout.outputLineLimit, outputOverflowsKey]);

	const { showContextMenu } = useCellContextMenu({
		cell,
		menuId: MenuId.PositronNotebookCellOutputActionContext,
	});
	const hasOutputs = outputs.length > 0;
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
		if (!hasOutputs) {
			return;
		}

		// Check if the click target is an <img> with a data: URL
		const src = isHTMLElement(event.target) && event.target.tagName === 'IMG'
			? (event.target as HTMLImageElement).src
			: undefined;
		const imageDataUrl = src?.startsWith('data:') ? src : undefined;

		// Set context key so the "Copy Image" menu item shows only when an image is targeted
		outputImageTargeted?.set(!!imageDataUrl);

		const onHide = () => outputImageTargeted?.set(false);

		if (imageDataUrl) {
			showContextMenu(
				{ x: event.clientX, y: event.clientY },
				undefined,
				onHide,
				{ arg: { imageDataUrl }, shouldForwardArgs: true },
			);
		} else {
			showContextMenu({ x: event.clientX, y: event.clientY }, undefined, onHide);
		}
	};

	return (
		<div className={positronClassNames(
			'positron-notebook-outputs-section',
			{ 'no-outputs': !hasOutputs },
			{ 'single-data-explorer': isSingleDataExplorer && !isCollapsed }
		)}>
			{hasOutputs ? <CellOutputCollapseButton cell={cell} /> : null}
			<CellOutputActionBar cell={cell} scrollTargetRef={outputsInnerRef} />
			<section
				aria-label={localize('positron.notebook.cellOutput', 'Cell output')}
				className='positron-notebook-code-cell-outputs positron-notebook-cell-outputs'
				data-testid='cell-output'
				onContextMenu={handleContextMenu}
			>
				<div ref={outputsInnerRef} className={positronClassNames(
					'positron-notebook-code-cell-outputs-inner',
					'positron-notebook-scrollable',
					'positron-notebook-scrollable-fade',
					{ 'output-scrolling': outputScrolling }
				)}>
					{isCollapsed
						? <CollapsedOutputLabel onExpand={handleShowHiddenOutput} />
						: outputs?.map((output) => (
							<NotebookErrorBoundary
								key={output.outputId}
								componentName={`CellOutput[${output.parsed.type}]`}
								level='output'
								logService={services.logService}
							>
								<CellOutput
									{...output}
									outputScrolling={outputScrolling}
									onShowFullOutput={() => cell.showFullOutput()}
									onTruncateOutput={() => cell.truncateOutput()}
								/>
							</NotebookErrorBoundary>
						))
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

interface CellOutputProps extends NotebookCellOutputs {
	outputScrolling: boolean;
	onShowFullOutput: () => void;
	onTruncateOutput: () => void;
}

const CellOutput = React.memo(function CellOutput(output: CellOutputProps) {
	if (output.preloadMessageResult) {
		return <PreloadMessageOutput preloadMessageResult={output.preloadMessageResult} />;
	}

	const { parsed, outputs, outputScrolling, onShowFullOutput, onTruncateOutput } = output;

	if (isParsedTextOutput(parsed)) {
		return <CellTextOutput
			{...parsed}
			outputScrolling={outputScrolling}
			onShowFullOutput={onShowFullOutput}
			onTruncateOutput={onTruncateOutput}
		/>;
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
		prevProps.parsed === nextProps.parsed &&
		prevProps.outputScrolling === nextProps.outputScrolling;
});

const CollapsedOutputLabel = ({ onExpand }: { onExpand: () => void }) => {
	const instance = useNotebookInstance();
	return <Button
		ariaLabel={expandOutputTooltip}
		className='collapsed-output-label'
		hoverManager={instance.hoverManager}
		tooltip={expandOutputTooltip}
		onPressed={onExpand}
	>
		{outputCollapsedLabel}
	</Button>;
};

