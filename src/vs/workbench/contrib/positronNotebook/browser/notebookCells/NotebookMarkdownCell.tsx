/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookMarkdownCell.css';

// React.
import { useRef } from 'react';

// Other dependencies.
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { useObservedValue } from '../useObservedValue.js';
import { Markdown } from './Markdown.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookMarkdownCell } from '../PositronNotebookCells/PositronNotebookMarkdownCell.js';
import { localize } from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { useCellContextMenu } from './useCellContextMenu.js';
import { getActiveWindow } from '../../../../../base/browser/dom.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { NotebookErrorBoundary } from '../NotebookErrorBoundary.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

// Localized strings.
const copyLabel = localize('positron.notebook.copy', "Copy");
const selectAllLabel = localize('positron.notebook.selectAll', "Select All");
const emptyMarkdownCell = localize('positron.notebooks.markdownCell.empty', "Empty markdown cell.");
const doubleClickToEdit = localize('positron.notebooks.markdownCell.doubleClickToEdit', " Double click to edit.");
const renderedMarkdownContent = localize('positron.notebooks.markdownCell.renderedContent', "Rendered markdown content");

export function NotebookMarkdownCell({ cell }: { cell: PositronNotebookMarkdownCell }) {

	const services = usePositronReactServicesContext();
	const markdownString = useObservedValue(cell.markdownString);
	const editorShown = useObservedValue(cell.editorShown);
	const markdownContentRef = useRef<HTMLElement>(null);

	const { showContextMenu } = useCellContextMenu({
		cell,
		menuId: MenuId.PositronNotebookCellContext,
	});

	/**
	 * Selects all content in the rendered markdown cell.
	 */
	const selectAll = () => {
		const selection = getActiveWindow().document.getSelection();
		if (selection && markdownContentRef.current) {
			selection.selectAllChildren(markdownContentRef.current);
		}
	};

	/**
	 * Shows the context menu with clipboard actions prepended.
	 * We use setTimeout to delay until the next tick so the browser has time
	 * to update the selection (e.g., when right-clicking highlights a word).
	 */
	const handleContextMenu = (event: React.MouseEvent) => {
		const x = event.clientX;
		const y = event.clientY;

		// Delay to next tick so the browser selection is up to date
		// (right-click may highlight a word after the contextmenu event fires)
		setTimeout(() => {
			const selection = getActiveWindow().document.getSelection();

			const getClipboardActions = (): IAction[] => {
				const actions: IAction[] = [];
				actions.push({
					id: 'positron.notebook.copy',
					label: copyLabel,
					tooltip: '',
					class: undefined,
					enabled: selection?.type === 'Range',
					run: () => {
						if (selection) {
							getActiveWindow().document.execCommand('copy');
						}
					}
				});
				actions.push({
					id: 'positron.notebook.selectAll',
					label: selectAllLabel,
					tooltip: '',
					class: undefined,
					enabled: true,
					run: selectAll
				});
				actions.push(new Separator());
				return actions;
			};

			showContextMenu({ x, y }, getClipboardActions);
		}, 0);
	};

	return (
		<NotebookCellWrapper
			cell={cell}
		>
			<div className={`positron-notebook-editor-container ${editorShown ? '' : 'editor-hidden'}`}>
				{editorShown ? <CellEditorMonacoWidget cell={cell} /> : null}
			</div>
			{!editorShown
				? (
					<section
						ref={markdownContentRef}
						aria-label={renderedMarkdownContent}
						className='cell-contents positron-notebook-cell-outputs'
						onContextMenu={handleContextMenu}
						onDoubleClick={() => cell.toggleEditor()}
					>
						<NotebookErrorBoundary
							componentName='MarkdownOutput'
							level='output'
							logService={services.logService}
						>
							{
								markdownString.length > 0
									? <Markdown content={markdownString} />
									: <div className='empty-output-msg'>
										{emptyMarkdownCell}
										{doubleClickToEdit}
									</div>
							}
						</NotebookErrorBoundary>
					</section>
				)
				: null
			}
		</NotebookCellWrapper>
	);
}



