/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { InlineTableDataGridInstance } from '../../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import { IPositronNotebookCodeCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';

/**
 * Rich runtime context passed to actions registered against
 * {@link MenuId.PositronNotebookInlineDataExplorerHeader}. Built fresh on each
 * click by the inline data explorer renderer (notebook cells today, Quarto
 * documents in the future); closes over the current state at the moment the
 * user activates the menu item.
 *
 * The shape is surface-agnostic: required fields (`documentUri`,
 * `sourceLanguage`, etc.) come from any inline grid renderer, while
 * notebook-only fields (`cell`, `notebookInstance`) are optional so a Quarto
 * caller can leave them undefined. Actions that need notebook-specific state
 * (e.g. visualize, which inserts code into a cell) check for these and skip
 * when absent.
 */
export interface IInlineDataExplorerActionContext {
	/** URI of the document or notebook this output belongs to. */
	documentUri: URI;
	/** Language of the source code that produced this output (e.g. 'python', 'r'); '' if unknown. */
	sourceLanguage: string;
	commId: string;
	variablePath: string[] | undefined;
	title: string;
	shape: { rows: number; columns: number };
	gridInstance: InlineTableDataGridInstance | undefined;
	/** Notebook-only. Quarto and other surfaces leave undefined. */
	cell?: IPositronNotebookCodeCell;
	/** Notebook-only. Quarto and other surfaces leave undefined. */
	notebookInstance?: IPositronNotebookInstance;
}

export class OpenInDataExplorerAction extends Action2 {
	static readonly ID = 'positronNotebook.inlineDataExplorer.openInDataExplorer';

	constructor() {
		super({
			id: OpenInDataExplorerAction.ID,
			title: localize('openInDataExplorer', 'Open in Data Explorer'),
			icon: { id: 'go-to-file' },
			f1: false,
			menu: {
				id: MenuId.PositronNotebookInlineDataExplorerHeader,
				group: 'navigation',
				order: 20,
			},
		});
	}

	async run(accessor: ServicesAccessor, ctx: IInlineDataExplorerActionContext): Promise<void> {
		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand('positron-data-explorer.openFromInline', {
			commId: ctx.commId,
			variablePath: ctx.variablePath,
			notebookUri: ctx.documentUri,
		});
	}
}

registerAction2(OpenInDataExplorerAction);
