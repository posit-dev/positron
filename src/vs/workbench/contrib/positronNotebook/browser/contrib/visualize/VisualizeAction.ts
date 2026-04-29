/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';
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
				// `positronNotebookCellIsCode` is bound only on the cell-scoped
				// context key service (see useCellContextKeys). Quarto inline data
				// explorers render with the global service, so this gate hides the
				// button there -- visualize today only inserts into notebook cells.
				when: ContextKeyExpr.and(
					ContextKeyExpr.has('positronNotebook.experimental'),
					ContextKeyExpr.has('positronNotebookCellIsCode'),
				),
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
		const notificationService = accessor.get(INotificationService);

		const columns: DataFrameColumn[] = [];
		for (let i = 0; i < ctx.gridInstance.columns; i++) {
			const col = ctx.gridInstance.column(i);
			if (col) {
				columns.push({ name: col.name, type: col.description });
			}
		}

		// Pick a Python-valid prefill for the dataframe field. `title` from the
		// inline grid metadata is usually the variable name itself for top-level
		// frames (e.g. "df"), so try it first. Fall back to a single-segment
		// `variablePath` for the case where the kernel set a display-only title
		// but still tagged the source variable. We deliberately don't synthesize
		// from multi-segment paths -- they're runtime access keys (dict/list
		// indices, attribute lookups), not Python syntax, and joining them with
		// "." would generate code that targets the wrong object.
		let candidateDfName = '';
		if (isValidDataFrameExpr(ctx.title)) {
			candidateDfName = ctx.title;
		} else if (ctx.variablePath && ctx.variablePath.length === 1 && isValidDataFrameExpr(ctx.variablePath[0])) {
			candidateDfName = ctx.variablePath[0];
		}
		const initialDfName = candidateDfName;

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
			try {
				await applyVisualizeResult(ctx.notebookInstance, ctx.cell as PositronNotebookCodeCell, snippet, result.mode);
			} catch (err) {
				// Surface insertion failures (e.g. the cell model couldn't be
				// resolved) instead of swallowing them silently. The user has
				// already committed via the modal so a notification is the
				// right channel for the failure signal.
				const message = err instanceof Error ? err.message : String(err);
				notificationService.notify({
					severity: Severity.Error,
					message: localize(
						'positron.notebook.visualize.insertFailed',
						"Couldn't insert visualization code: {0}",
						message,
					),
				});
			}
		} finally {
			suggestionCts.cancel();
			suggestionCts.dispose();
		}
	}
}

registerAction2(VisualizeDataFrameAction);
