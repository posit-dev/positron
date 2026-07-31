/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
	CodeAction,
	CodeActionContext,
	CodeActionList,
	CodeActionProvider,
	IWorkspaceTextEdit,
	WorkspaceEdit,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { toCellRange, toDocumentRange } from '../common/quartoPositionMapping.js';
import { guardAgainstShadowCellUriLeaks } from '../common/quartoShadowUriLeakGuard.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';
import { invokeSafely, QuartoShadowLanguageBridge } from './quartoShadowLanguageBridge.js';

/** Type guard for the text-edit variant of a {@link WorkspaceEdit} entry. */
function isWorkspaceTextEdit(edit: WorkspaceEdit['edits'][number]): edit is IWorkspaceTextEdit {
	return URI.isUri((edit as IWorkspaceTextEdit).resource) && !!(edit as IWorkspaceTextEdit).textEdit;
}

/**
 * Code-action provider for Quarto (`.qmd`) documents that delegates requests
 * inside code cells to the language servers responsible for the cell's
 * language, mirroring {@link QuartoShadowCompletionProvider}.
 *
 * For a request inside a code cell it forwards to the providers registered
 * for the cell's text model (translating the range into cell coordinates),
 * then translates the resulting actions' edits, diagnostics, and ranges back
 * into document coordinates. Workspace edits that target shadow cells are
 * rewritten onto the `.qmd` URI, so applying them edits the real document
 * (the shadow is derived state and must never be edited directly).
 */
export class QuartoShadowCodeActionProvider implements CodeActionProvider {

	readonly displayName = 'QuartoShadowCellCodeActions';

	// Routes a returned action back to the provider and cell that produced it
	// so resolveCodeAction can delegate (cacheIds are per-provider) and
	// translate the resolved edit. Weak so entries clear with the actions.
	private readonly _actionSources = new WeakMap<CodeAction, { provider: CodeActionProvider; cell: QuartoCodeCell }>();

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideCodeActions(
		model: ITextModel,
		range: Range | Selection,
		context: CodeActionContext,
		token: CancellationToken,
	): Promise<CodeActionList | undefined> {
		const request = this._bridge.resolveRequest(model, range.startLineNumber);
		if (!request) {
			return undefined;
		}
		const { cell, cellModel } = request;

		const cellRange = toCellRange(cell, range);
		const providers = this._languageFeaturesService.codeActionProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		if (providers.length === 0) {
			return undefined;
		}

		const lists = await Promise.all(providers.map(async provider => {
			// The cell providers gather the relevant diagnostics from the cell
			// model's own markers, so the context (only/trigger) forwards as-is.
			const list = await invokeSafely(
				() => provider.provideCodeActions(cellModel, cellRange, context, token), this._logService);
			return list ? { provider, list } : undefined;
		}));
		if (token.isCancellationRequested) {
			return undefined;
		}

		const actions: CodeAction[] = [];
		const disposables: (() => void)[] = [];

		for (const entry of lists) {
			if (!entry) {
				continue;
			}
			const { provider, list } = entry;
			if (list.dispose) {
				disposables.push(() => list.dispose());
			}
			for (const action of list.actions) {
				this._translateActionToDocument(action, cell);
				this._actionSources.set(action, { provider, cell });
				actions.push(action);
			}
		}

		return guardAgainstShadowCellUriLeaks('code action', {
			actions,
			dispose: () => disposables.forEach(dispose => dispose()),
		}, this._logService);
	}

	async resolveCodeAction(codeAction: CodeAction, token: CancellationToken): Promise<CodeAction> {
		const source = this._actionSources.get(codeAction);
		if (!source?.provider.resolveCodeAction) {
			return codeAction;
		}

		// resolveCodeAction is only invoked to fill a missing edit. The
		// underlying provider mutates and returns the same object (matched by
		// its per-provider cacheId), so after delegating we translate the
		// freshly filled, cell-space edit back to document space in place.
		const resolved = await source.provider.resolveCodeAction(codeAction, token);
		if (!resolved || token.isCancellationRequested) {
			return codeAction;
		}
		if (resolved.edit) {
			this._translateWorkspaceEditToDocument(resolved.edit);
		}
		return guardAgainstShadowCellUriLeaks('code action resolve', resolved, this._logService) ?? codeAction;
	}

	/**
	 * Translate an action's edits, diagnostics, and ranges from cell into
	 * document space, in place. Diagnostics and ranges originate from the
	 * request cell; workspace edits may target any shadow cell and are mapped
	 * through their owning cell.
	 */
	private _translateActionToDocument(action: CodeAction, cell: QuartoCodeCell): void {
		if (action.edit) {
			this._translateWorkspaceEditToDocument(action.edit);
		}
		if (action.diagnostics) {
			for (const diagnostic of action.diagnostics) {
				const range = toDocumentRange(cell, diagnostic);
				diagnostic.startLineNumber = range.startLineNumber;
				diagnostic.startColumn = range.startColumn;
				diagnostic.endLineNumber = range.endLineNumber;
				diagnostic.endColumn = range.endColumn;
			}
		}
		if (action.ranges) {
			action.ranges = action.ranges.map(r => toDocumentRange(cell, r));
		}
	}

	/**
	 * Rewrite the text edits of a workspace edit that target shadow cells onto
	 * their `.qmd` document URI, with ranges translated to document space, in
	 * place. Edits to other resources pass through unchanged; edits to
	 * unmappable shadow cells are dropped (the leak guard would reject them).
	 */
	private _translateWorkspaceEditToDocument(edit: WorkspaceEdit): void {
		const translated: WorkspaceEdit['edits'] = [];
		for (const entry of edit.edits) {
			if (!isWorkspaceTextEdit(entry)) {
				translated.push(entry);
				continue;
			}
			const mapped = this._bridge.mapLocationToDocument(entry.resource, entry.textEdit.range);
			if (!mapped) {
				continue;
			}
			translated.push({
				...entry,
				resource: mapped.uri,
				textEdit: { ...entry.textEdit, range: mapped.range },
			});
		}
		edit.edits = translated;
	}
}
