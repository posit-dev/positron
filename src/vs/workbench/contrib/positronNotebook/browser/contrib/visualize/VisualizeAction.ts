/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import type { PositronNotebookCodeCell } from '../../PositronNotebookCells/PositronNotebookCodeCell.js';
import type { IInlineDataExplorerActionContext } from '../../notebookCells/InlineDataExplorerActions.js';
import { applyVisualizeResult } from './applyVisualizeResult.js';
import { generateVizCode, isValidDataFrameExpr } from './generateVizCode.js';
import { showVisualizeModalDialog, validateVisualizationSuggestion, DataFrameColumn } from './visualizeModalDialog.js';

export class VisualizeDataFrameAction extends Action2 {
	static readonly ID = 'positronNotebook.inlineDataExplorer.visualize';

	constructor() {
		super({
			id: VisualizeDataFrameAction.ID,
			title: localize('positron.notebook.visualize.inlineButton', 'Visualize...'),
			icon: { id: 'graph' },
			f1: false,
			menu: {
				id: MenuId.PositronNotebookInlineDataExplorerHeader,
				when: ContextKeyExpr.has('positronNotebook.experimental'),
				group: 'navigation',
				order: 10,
			},
		});
	}

	async run(accessor: ServicesAccessor, ctx: IInlineDataExplorerActionContext): Promise<void> {
		// Surface-agnostic gates: skip languages we don't support and surfaces
		// that don't have a connected grid yet.
		if (ctx.sourceLanguage !== 'python') { return; }
		if (!ctx.gridInstance) { return; }
		// V1 only inserts code into notebook cells. Quarto and other surfaces
		// will need a document-side applyVisualizeResult equivalent before they
		// can host this action.
		if (!ctx.cell || !ctx.notebookInstance) { return; }

		const commandService = accessor.get(ICommandService);

		const columns: DataFrameColumn[] = [];
		for (let i = 0; i < ctx.gridInstance.columns; i++) {
			const col = ctx.gridInstance.column(i);
			if (col) {
				columns.push({ name: col.name, type: col.description });
			}
		}

		const initialDfName = ctx.variablePath && ctx.variablePath.length > 0 && isValidDataFrameExpr(ctx.title)
			? ctx.title
			: '';

		// Fire the LLM suggestion request in parallel with the dialog so the
		// user sees fields populate without waiting. Cancel if the dialog
		// closes before the request resolves.
		const suggestionCts = new CancellationTokenSource();
		try {
			const suggestionPromise = commandService
				.executeCommand<unknown>(
					'positron-assistant.suggestVisualization',
					ctx.documentUri.toString(),
					ctx.cell.index,
					initialDfName,
					columns,
					suggestionCts.token,
				)
				.then((r) => validateVisualizationSuggestion(r))
				.catch(() => null);

			const result = await showVisualizeModalDialog(initialDfName, columns, suggestionPromise, ctx.documentUri);
			if (!result) { return; }
			const snippet = generateVizCode(result.answers);
			// applyVisualizeResult needs the concrete class (model + getTextEditorModel);
			// the inline data explorer only mounts inside a real notebook so this is safe.
			await applyVisualizeResult(ctx.notebookInstance, ctx.cell as PositronNotebookCodeCell, snippet, result.mode);
		} finally {
			suggestionCts.cancel();
			suggestionCts.dispose();
		}
	}
}

registerAction2(VisualizeDataFrameAction);
