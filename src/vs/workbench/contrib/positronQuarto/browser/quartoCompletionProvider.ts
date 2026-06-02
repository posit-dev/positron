/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
	CompletionContext,
	CompletionItem,
	CompletionItemProvider,
	CompletionList,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { isInsideCellCode, toCellPosition, toCellRange, toDocumentRange } from '../common/quartoPositionMapping.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';
import { IQuartoCellModelService } from './quartoCellModelService.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';

/**
 * Completion provider for Quarto (`.qmd`) documents that delegates requests
 * inside code chunks to the language servers responsible for the chunk's
 * language.
 *
 * For a request inside a code cell it forwards to the providers registered for
 * the cell's synthetic model (translating the cursor into cell coordinates),
 * then translates the resulting ranges back into document coordinates. Requests
 * in prose (or on a chunk's fence lines) return `undefined`, leaving them for
 * the Quarto extension's prose language features.
 */
export class QuartoCompletionProvider implements CompletionItemProvider {

	readonly _debugDisplayName = 'QuartoCellCompletions';

	// Trigger characters that should re-invoke completions inside a cell. Member
	// access ('.', '$', ':') covers the common cross-language cases; the real
	// language is resolved per request from the cell under the cursor.
	readonly triggerCharacters = ['.', '$', ':'];

	// Routes a returned suggestion back to the provider and cell that produced
	// it so resolveCompletionItem can delegate and translate. Weak so entries
	// clear with the items.
	private readonly _itemSources = new WeakMap<CompletionItem, { provider: CompletionItemProvider; cell: QuartoCodeCell }>();

	constructor(
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoCellModelService private readonly _cellModelService: IQuartoCellModelService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
	) { }

	async provideCompletionItems(
		model: ITextModel,
		position: Position,
		context: CompletionContext,
		token: CancellationToken,
	): Promise<CompletionList | undefined> {
		if (!this._documentModelService.hasModel(model.uri)) {
			return undefined;
		}
		const documentModel = this._documentModelService.getModelForUri(model.uri);

		const cell = documentModel.getCellAtLine(position.lineNumber);
		if (!cell || !isInsideCellCode(cell, position.lineNumber)) {
			// Prose or a fence line: let the Quarto extension handle it.
			return undefined;
		}

		const cellModel = this._cellModelService.getCellModel(model.uri, cell);
		if (!cellModel) {
			return undefined;
		}

		const cellPosition = toCellPosition(cell, position);
		const providers = this._languageFeaturesService.completionProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		if (providers.length === 0) {
			return undefined;
		}

		const lists = await Promise.all(providers.map(async provider => {
			try {
				const list = await provider.provideCompletionItems(cellModel, cellPosition, context, token);
				return list ? { provider, list } : undefined;
			} catch {
				// A single provider failing must not sink the whole request.
				return undefined;
			}
		}));
		if (token.isCancellationRequested) {
			return undefined;
		}

		const suggestions: CompletionItem[] = [];
		const disposables: (() => void)[] = [];
		let incomplete = false;

		for (const entry of lists) {
			if (!entry) {
				continue;
			}
			const { provider, list } = entry;
			incomplete = incomplete || !!list.incomplete;
			if (list.dispose) {
				disposables.push(() => list.dispose!());
			}
			for (const suggestion of list.suggestions) {
				this._translateSuggestion(cell, suggestion);
				this._itemSources.set(suggestion, { provider, cell });
				suggestions.push(suggestion);
			}
		}

		return {
			suggestions,
			incomplete,
			dispose: () => disposables.forEach(d => d()),
		};
	}

	async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
		const source = this._itemSources.get(item);
		if (!source?.provider.resolveCompletionItem) {
			return item;
		}
		const cell = source.cell;

		// The underlying provider produced (and resolves against) cell
		// coordinates, but `item` now carries document coordinates. Present it in
		// cell space for the round trip, then translate the result back.
		const cellItem = this._toCellSpace(cell, item);
		const resolved = await source.provider.resolveCompletionItem(cellItem, token);
		if (!resolved || token.isCancellationRequested) {
			return item;
		}
		this._translateSuggestion(cell, resolved);
		return resolved;
	}

	/** Translate a suggestion's ranges from cell to document space, in place. */
	private _translateSuggestion(cell: QuartoCodeCell, suggestion: CompletionItem): void {
		suggestion.range = Range.isIRange(suggestion.range)
			? toDocumentRange(cell, suggestion.range)
			: {
				insert: toDocumentRange(cell, suggestion.range.insert),
				replace: toDocumentRange(cell, suggestion.range.replace),
			};
		if (suggestion.additionalTextEdits) {
			for (const edit of suggestion.additionalTextEdits) {
				edit.range = toDocumentRange(cell, edit.range);
			}
		}
	}

	/** Produce a shallow copy of an item with its ranges shifted to cell space. */
	private _toCellSpace(cell: QuartoCodeCell, item: CompletionItem): CompletionItem {
		return {
			...item,
			range: Range.isIRange(item.range)
				? toCellRange(cell, item.range)
				: {
					insert: toCellRange(cell, item.range.insert),
					replace: toCellRange(cell, item.range.replace),
				},
			additionalTextEdits: item.additionalTextEdits?.map(edit => ({
				...edit,
				range: toCellRange(cell, edit.range),
			})),
		};
	}
}
