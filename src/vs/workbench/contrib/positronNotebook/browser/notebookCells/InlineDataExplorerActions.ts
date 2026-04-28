/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { TableDataDataGridInstance } from '../../../../services/positronDataExplorer/browser/tableDataDataGridInstance.js';
import { IPositronNotebookCodeCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';

/**
 * Rich runtime context passed to actions registered against
 * {@link MenuId.PositronNotebookInlineDataExplorerHeader}. Built fresh on each
 * click by `InlineDataExplorer`; closes over the current React state at the
 * moment the user activates the menu item.
 *
 * Every field is populated by the renderer; individual actions ignore the
 * fields they don't need.
 */
export interface IInlineDataExplorerActionContext {
	cell: IPositronNotebookCodeCell;
	notebookInstance: IPositronNotebookInstance;
	commId: string;
	variablePath: string[] | undefined;
	title: string;
	shape: { rows: number; columns: number };
	gridInstance: TableDataDataGridInstance | undefined;
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
			notebookUri: ctx.notebookInstance.uri,
		});
	}
}

registerAction2(OpenInDataExplorerAction);
