/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IHeadlessLanguageModelService } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import type { PositronNotebookCodeCell } from '../../PositronNotebookCells/PositronNotebookCodeCell.js';
import type { IInlineDataExplorerActionContext } from '../../notebookCells/InlineDataExplorerActions.js';
import { applyVisualizeResult } from './applyVisualizeResult.js';
import { VISUALIZE_MODEL_KEY } from './config.js';
import { generateVizCode, isValidDataFrameExpr } from './generateVizCode.js';
import { generateVisualizationSuggestion } from './visualizationSuggestion.js';
import { showVisualizeModalDialog, DataFrameColumn } from './visualizeModalDialog.js';

/**
 * Decode one segment of a `variablePath` array. The kernel encodes each
 * segment via `encode_access_key`, producing a JSON string like
 * `{"type":"str","data":"my_df"}`. Returns the raw `data` string for
 * string-typed keys. Falls back to the raw input for non-JSON segments
 * (older kernels may emit plain variable names).
 */
function decodeAccessKey(encoded: string): string | undefined {
	try {
		const parsed = JSON.parse(encoded);
		if (parsed && typeof parsed === 'object' && parsed.type === 'str' && typeof parsed.data === 'string') {
			return parsed.data;
		}
		return undefined;
	} catch {
		return encoded;
	}
}

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
				// context key service (see PositronNotebookCell.attachContainer).
				// Quarto inline data explorers render with the global service, so
				// this gate hides the button there -- visualize today only inserts
				// into notebook cells.
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

		const headlessLmService = accessor.get(IHeadlessLanguageModelService);
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);

		const columns: DataFrameColumn[] = [];
		for (let i = 0; i < ctx.gridInstance.columns; i++) {
			const col = ctx.gridInstance.column(i);
			if (col) {
				columns.push({ name: col.name, type: col.description });
			}
		}

		// Prefer source-path metadata over display title for the dataframe
		// prefill. `variablePath` entries are encoded access keys (JSON
		// objects like `{"type":"str","data":"df"}`), so we decode the first
		// segment to recover the raw variable name. Only single-segment
		// paths are usable as Python expressions; multi-segment paths mean
		// the object isn't a simple top-level variable, so we leave the
		// field empty rather than guessing from `title`.
		let initialDfName = '';
		if (ctx.variablePath && ctx.variablePath.length === 1) {
			const decoded = decodeAccessKey(ctx.variablePath[0]);
			if (decoded !== undefined && isValidDataFrameExpr(decoded)) {
				initialDfName = decoded;
			}
		}
		if (!initialDfName && (!ctx.variablePath || ctx.variablePath.length === 0) && isValidDataFrameExpr(ctx.title)) {
			initialDfName = ctx.title;
		}

		// Fire the LLM suggestion request in parallel with the dialog so the
		// user sees fields populate without waiting. Cancel if the dialog
		// closes before the request resolves.
		const suggestionCts = new CancellationTokenSource();
		try {
			const modelSetting = configurationService.getValue<string[]>(VISUALIZE_MODEL_KEY);
			const suggestionPromise = generateVisualizationSuggestion(
				headlessLmService,
				ctx.notebookInstance.cells.get(),
				ctx.cell.index,
				initialDfName,
				columns,
				modelSetting,
				suggestionCts.token,
			).catch(() => null);

			const result = await showVisualizeModalDialog(initialDfName, columns, suggestionPromise, ctx.documentUri);
			if (!result) { return; }
			const snippet = generateVizCode(result.answers);
			// applyVisualizeResult needs the concrete class (model + getTextEditorModel);
			// the inline data explorer only mounts inside a real notebook so this is safe.
			try {
				await applyVisualizeResult(ctx.notebookInstance, ctx.cell as PositronNotebookCodeCell, snippet, result.mode);
				const cellToRun = result.mode === 'newCell'
					? ctx.notebookInstance.cells.get()[ctx.cell.index + 1]
					: ctx.cell;
				if (cellToRun) {
					await ctx.notebookInstance.runCells([cellToRun]);
				}
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
