/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCodeCell.css';

// React.
import React, { useCallback, useEffect } from 'react';

// Other dependencies.
import { NotebookCellOutputs } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { getPlainTextOutputContent, isParsedTextOutput } from '../getOutputContents.js';
import { useObservedValue, useDebouncedObservedValue } from '../useObservedValue.js';
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
import { getActiveWindow, isHTMLElement } from '../../../../../base/browser/dom.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';
import { ShadowDomContent } from '../../../../../base/browser/positron/ShadowDomContent.js';
import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';
import { Markdown } from './Markdown.js';
import { LatexOutput } from './LatexOutput.js';
import { useCellContextMenu } from './useCellContextMenu.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { DataExplorerCellOutput } from './DataExplorerCellOutput.js';
import { JsonOutput } from './JsonOutput.js';
import { NotebookErrorBoundary } from '../NotebookErrorBoundary.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { useScrollingIndicator } from './useScrollingIndicator.js';
import { CellOutputActionBar } from './CellOutputActionBar.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { HorizontalSplitter, HorizontalSplitterResizeParams } from '../../../../../base/browser/ui/positronComponents/splitters/horizontalSplitter.js';
import { serializeJsonOutput } from '../copyJsonUtils.js';
import { CellSelectionType } from '../selectionMachine.js';

/** The minimum height (pixels) that scrollable outputs can be resized to. */
const MINIMUM_SCROLLABLE_OUTPUT_HEIGHT = 50;

// Passthrough policy to assign HTML output under Trusted Types. Safe here: active
// content is routed to a webview upstream and innerHTML never runs scripts.
const htmlOutputTTPolicy = createTrustedTypesPolicy('positronNotebookHtmlOutput', { createHTML: value => value });

const copyOutputTextLabel = localize('positron.notebook.copyOutputText', "Copy Output Text");
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
	const contextKeys = cell.contextKeys;
	const { selectionStateMachine } = useNotebookInstance();
	const handleOutputFocus = useCallback(() => {
		contextKeys?.outputFocused.set(true);
		selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
	}, [contextKeys, selectionStateMachine, cell]);
	const handleOutputBlur = useCallback((e: React.FocusEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			contextKeys?.outputFocused.set(false);
		}
	}, [contextKeys]);
	const notebookOptions = useNotebookOptions();
	const layout = notebookOptions.getLayoutConfiguration();
	const outputsInnerRef = React.useRef<HTMLDivElement>(null);
	useScrollingIndicator(outputsInnerRef);

	// Per-cell scrolling override takes precedence over global setting.
	// A webview output (position:fixed overlay) is not clipped by the output
	// container's max-height, so applying the scrolling cap would let it overflow
	// into neighboring cells. Webviews size to their own content instead.
	const hasWebviewOutput = outputs.some(o => o.preloadMessageResult !== undefined);
	const outputScrollingEnabled = perCellScrolling ?? layout.outputScrolling;
	const applyOutputScrolling = outputScrollingEnabled && !hasWebviewOutput;

	const clearHeightOverride = useCallback(() => {
		const el = outputsInnerRef.current;
		if (el) {
			el.style.height = '';
			el.style.maxHeight = '';
			el.classList.remove('height-override');
		}
	}, []);

	// Reset height override when outputs change (new execution) or scrolling mode toggles.
	useEffect(() => {
		clearHeightOverride();
	}, [outputs, applyOutputScrolling, clearHeightOverride]);

	const onBeginResize = useCallback((): HorizontalSplitterResizeParams => {
		const el = outputsInnerRef.current;
		return {
			startingHeight: el?.offsetHeight ?? 0,
			minimumHeight: MINIMUM_SCROLLABLE_OUTPUT_HEIGHT,
			// Cap the max height to the output content.
			maximumHeight: Math.max(el?.scrollHeight ?? 0, MINIMUM_SCROLLABLE_OUTPUT_HEIGHT),
		};
	}, []);

	const onResize = useCallback((height: number) => {
		const el = outputsInnerRef.current;
		if (el) {
			el.style.height = height + 'px';
			el.style.maxHeight = height + 'px';
			el.classList.add('height-override');
		}
	}, []);

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

		const x = event.clientX;
		const y = event.clientY;

		// Check if the click target is an <img> with a data: URL
		const src = isHTMLElement(event.target) && event.target.tagName === 'IMG'
			? (event.target as HTMLImageElement).src
			: undefined;
		const imageDataUrl = src?.startsWith('data:') ? src : undefined;

		const targetElement = isHTMLElement(event.target) ? event.target : undefined;
		const jsonOutputElement = targetElement?.closest<HTMLElement>('[data-positron-json-output-id]');
		const jsonOutputId = jsonOutputElement?.dataset.positronJsonOutputId;
		const jsonOutput = jsonOutputId
			? outputs.find(o => o.outputId === jsonOutputId && o.parsed.type === 'json')
			: undefined;
		const jsonText = jsonOutput?.parsed.type === 'json'
			? serializeJsonOutput(jsonOutput.parsed.data)
			: undefined;

		// Set context keys so targeted copy menu items show only for the right output type.
		contextKeys?.outputImageTargeted.set(!!imageDataUrl);
		contextKeys?.outputJsonTargeted.set(!!jsonText);

		const onHide = () => {
			contextKeys?.outputImageTargeted.set(false);
			contextKeys?.outputJsonTargeted.set(false);
		};

		// Delay to next tick so the browser selection is up to date
		// (right-click may highlight a word after the contextmenu event fires)
		setTimeout(() => {
			const selection = getActiveWindow().document.getSelection();
			const hasTextOutputs = outputs.some(o => isParsedTextOutput(o.parsed));

			const getClipboardActions = (): IAction[] => {
				if (!hasTextOutputs) {
					return [];
				}

				return [
					{
						id: 'positronNotebook.copyOutputText',
						label: copyOutputTextLabel,
						tooltip: '',
						class: undefined,
						enabled: true,
						run: () => {
							if (selection?.type === 'Range') {
								// Copy the user's text selection
								getActiveWindow().document.execCommand('copy');
							} else {
								// Fall back to copying all text output from the cell
								services.clipboardService.writeText(getPlainTextOutputContent(outputs));
							}
						}
					},
					new Separator(),
				];
			};

			let menuArg: { imageDataUrl: string } | { jsonText: string } | undefined;
			if (imageDataUrl) {
				menuArg = { imageDataUrl };
			} else if (jsonText) {
				menuArg = { jsonText };
			}
			const menuActionOptions = menuArg
				? { arg: menuArg, shouldForwardArgs: true }
				: undefined;

			showContextMenu({ x, y }, getClipboardActions, onHide, menuActionOptions);
		}, 0);
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
				role='region'
				tabIndex={0}
				onBlur={handleOutputBlur}
				onContextMenu={handleContextMenu}
				onFocus={handleOutputFocus}
			>
				<div ref={outputsInnerRef} className={positronClassNames(
					'positron-notebook-code-cell-outputs-inner',
					'positron-notebook-scrollable',
					'positron-notebook-scrollable-fade',
					{ 'output-scrolling': applyOutputScrolling },
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
									outputScrolling={outputScrollingEnabled}
									onShowFullOutput={() => cell.showFullOutput()}
								/>
							</NotebookErrorBoundary>
						))
					}
				</div>
				{applyOutputScrolling && !isCollapsed && hasOutputs &&
					<HorizontalSplitter
						showResizeIndicator
						onBeginResize={onBeginResize}
						onDoubleClick={clearHeightOverride}
						onResize={onResize}
					/>
				}
			</section>
		</div>
	);
}, (prevProps, nextProps) => {
	// Simple reference equality - outputs array is stable when nothing changes
	return prevProps.outputs === nextProps.outputs;
});

export const NotebookCodeCell = React.memo(function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	// Debounce transitions to empty only while the cell is executing so
	// re-execution doesn't flash. Explicit clears (when idle) propagate
	// immediately. We read executionStatus synchronously inside the predicate
	// so it reflects the state at the moment outputs change.
	const shouldDebounceOutputs = React.useCallback(
		(outputs: NotebookCellOutputs[]) =>
			outputs.length === 0 && cell.executionStatus.get() !== 'idle',
		[cell.executionStatus]
	);
	const outputContents = useDebouncedObservedValue(cell.outputs, shouldDebounceOutputs);
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
}

const CellOutput = React.memo(function CellOutput(output: CellOutputProps) {
	if (output.preloadMessageResult) {
		return <PreloadMessageOutput outputScrolling={output.outputScrolling} preloadMessageResult={output.preloadMessageResult} />;
	}

	const { parsed, outputs, outputScrolling, onShowFullOutput } = output;

	if (isParsedTextOutput(parsed)) {
		return <CellTextOutput
			{...parsed}
			outputScrolling={outputScrolling}
			onShowFullOutput={onShowFullOutput}
		/>;
	}

	switch (parsed.type) {
		case 'interrupt':
			return <div className='notebook-error'>
				{localize('cellExecutionKeyboardInterrupt', 'Cell execution stopped due to keyboard interrupt.')}
			</div>;
		case 'image':
			return <img alt='output image' height={parsed.height} src={parsed.dataUrl} width={parsed.width} />;
		case 'html': {
			// Full HTML documents go in a shadow root; renderHtml only handles fragments.
			const lower = parsed.content.toLowerCase();
			const isFullDocument = lower.includes('<!doctype') ||
				lower.includes('<html') ||
				lower.includes('<body');
			return isFullDocument
				? <ShadowDomContent content={parsed.content} trustedTypesPolicy={htmlOutputTTPolicy} />
				: renderHtml(parsed.content);
		}
		case 'markdown':
			return <Markdown content={parsed.content} />;
		case 'latex':
			return <LatexOutput content={parsed.content} />;
		case 'json':
			return <JsonOutput data={parsed.data} outputId={output.outputId} />;
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
