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
import { isInsideCellCode, toCellRange, toDocumentRange } from '../common/quartoPositionMapping.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { createQuartoCellUri } from './quartoCellModelSync.js';
import { IQuartoCellModelService } from './quartoCellModelService.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';

/** Type guard for the text-edit variant of a {@link WorkspaceEdit} entry. */
function isWorkspaceTextEdit(edit: WorkspaceEdit['edits'][number]): edit is IWorkspaceTextEdit {
	return URI.isUri((edit as IWorkspaceTextEdit).resource) && !!(edit as IWorkspaceTextEdit).textEdit;
}

/**
 * Code-action provider for Quarto (`.qmd`) documents that delegates requests
 * inside code chunks to the language servers responsible for the chunk's
 * language, mirroring {@link QuartoCompletionProvider}.
 *
 * For a request inside a code chunk it forwards to the providers registered for
 * the chunk's synthetic cell model (translating the range into cell
 * coordinates), then translates the resulting actions' edits, diagnostics, and
 * ranges back into document coordinates. The cell providers gather the relevant
 * diagnostics themselves from the cell model's markers, so the bridge forwards
 * the request context unchanged. Requests in prose (or on a chunk's fence
 * lines) return `undefined`, leaving them for the Quarto extension.
 */
export class QuartoCodeActionProvider implements CodeActionProvider {

	readonly displayName = 'Quarto Cell Code Actions';

	// Routes a returned action back to the provider, cell, and document that
	// produced it so resolveCodeAction can delegate (cacheIds are per-provider)
	// and translate the resolved edit. Weak so entries clear with the actions.
	private readonly _actionSources = new WeakMap<CodeAction, { provider: CodeActionProvider; cell: QuartoCodeCell; documentModel: IQuartoDocumentModel }>();

	constructor(
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoCellModelService private readonly _cellModelService: IQuartoCellModelService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
	) { }

	async provideCodeActions(
		model: ITextModel,
		range: Range | Selection,
		context: CodeActionContext,
		token: CancellationToken,
	): Promise<CodeActionList | undefined> {
		if (!this._documentModelService.hasModel(model.uri)) {
			return undefined;
		}
		const documentModel = this._documentModelService.getModelForUri(model.uri);

		const cell = documentModel.getCellAtLine(range.startLineNumber);
		if (!cell || !isInsideCellCode(cell, range.startLineNumber)) {
			// Prose or a fence line: let the Quarto extension handle it.
			return undefined;
		}

		const cellModel = this._cellModelService.getCellModel(model.uri, cell);
		if (!cellModel) {
			return undefined;
		}

		const cellRange = toCellRange(cell, range);
		const providers = this._languageFeaturesService.codeActionProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		if (providers.length === 0) {
			return undefined;
		}

		const lists = await Promise.all(providers.map(async provider => {
			try {
				// The cell providers gather the relevant diagnostics from the cell
				// model's own markers, so the context (only/trigger) forwards as-is.
				const list = await provider.provideCodeActions(cellModel, cellRange, context, token);
				return list ? { provider, list } : undefined;
			} catch {
				// A single provider failing must not sink the whole request.
				return undefined;
			}
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
				this._translateActionToDocument(action, cell, documentModel);
				this._actionSources.set(action, { provider, cell, documentModel });
				actions.push(action);
			}
		}

		return {
			actions,
			dispose: () => disposables.forEach(d => d()),
		};
	}

	async resolveCodeAction(codeAction: CodeAction, token: CancellationToken): Promise<CodeAction> {
		const source = this._actionSources.get(codeAction);
		if (!source?.provider.resolveCodeAction) {
			return codeAction;
		}

		// resolveCodeAction is only invoked to fill a missing edit. The underlying
		// provider mutates and returns the same object (matched by its per-provider
		// cacheId), so after delegating we translate the freshly filled, cell-space
		// edit back to document space on that same action.
		const resolved = await source.provider.resolveCodeAction(codeAction, token);
		if (!resolved || token.isCancellationRequested) {
			return codeAction;
		}
		if (resolved.edit) {
			this._translateWorkspaceEditToDocument(resolved.edit, source.documentModel);
		}
		return resolved;
	}

	/**
	 * Translate an action's edits, diagnostics, and ranges from cell into document
	 * space, in place. Edits and diagnostics for the request originate from the
	 * given cell; edits targeting any other chunk of the same document are also
	 * mapped through their owning cell.
	 */
	private _translateActionToDocument(action: CodeAction, cell: QuartoCodeCell, documentModel: IQuartoDocumentModel): void {
		if (action.edit) {
			this._translateWorkspaceEditToDocument(action.edit, documentModel);
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
	 * Rewrite the text edits of a workspace edit from cell models of the given
	 * document onto the document URI, with ranges translated to document space, in
	 * place. Edits to other resources pass through unchanged.
	 */
	private _translateWorkspaceEditToDocument(edit: WorkspaceEdit, documentModel: IQuartoDocumentModel): void {
		const cellByUri = this._cellsByUri(documentModel);
		for (let i = 0; i < edit.edits.length; i++) {
			const entry = edit.edits[i];
			if (!isWorkspaceTextEdit(entry)) {
				continue;
			}
			const cell = cellByUri.get(entry.resource.toString());
			if (!cell) {
				continue;
			}
			edit.edits[i] = {
				...entry,
				resource: documentModel.uri,
				textEdit: { ...entry.textEdit, range: toDocumentRange(cell, entry.textEdit.range) },
			};
		}
	}

	/** Map each cell model URI of a document to its cell. */
	private _cellsByUri(documentModel: IQuartoDocumentModel): Map<string, QuartoCodeCell> {
		const cellByUri = new Map<string, QuartoCodeCell>();
		for (const cell of documentModel.cells) {
			cellByUri.set(createQuartoCellUri(documentModel.uri, cell.index).toString(), cell);
		}
		return cellByUri;
	}
}
