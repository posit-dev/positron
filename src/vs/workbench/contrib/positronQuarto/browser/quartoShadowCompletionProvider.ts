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
import { ILogService } from '../../../../platform/log/common/log.js';
import { toCellPosition, toCellRange, toDocumentRange } from '../common/quartoPositionMapping.js';
import { guardAgainstShadowCellUriLeaks } from '../common/quartoShadowUriLeakGuard.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';
import { invokeSafely, QuartoShadowLanguageBridge } from './quartoShadowLanguageBridge.js';

/**
 * Completion provider for Quarto (`.qmd`) documents that delegates requests
 * inside code cells to the language servers responsible for the cell's
 * language, via the shadow notebook's cell models.
 *
 * For a request inside a code cell it forwards to the providers registered
 * for the cell's text model (translating the cursor into cell coordinates),
 * then translates the resulting ranges back into document coordinates.
 * Requests in prose (or on a chunk's fence lines) return `undefined`, leaving
 * them for the Quarto extension's prose language features.
 */
export class QuartoShadowCompletionProvider implements CompletionItemProvider {

	readonly _debugDisplayName = 'QuartoShadowCellCompletions';

	// Trigger characters that should re-invoke completions inside a cell.
	// The set is a static superset across cell languages: member access for
	// Python/Julia ('.'), R list/slot access ('$', '@'), and namespace access
	// (':', matching 'xx::' after two keystrokes). A per-request dynamic set
	// isn't possible - the suggest controller collects trigger characters per
	// model, but a .qmd model hosts cells of several languages at once. Over-
	// triggering only costs a request the underlying provider answers empty.
	readonly triggerCharacters = ['.', '$', ':', '@'];

	// Routes a returned suggestion back to the provider and cell that produced
	// it so resolveCompletionItem can delegate and translate. Weak so entries
	// clear with the items.
	private readonly _itemSources = new WeakMap<CompletionItem, { provider: CompletionItemProvider; cell: QuartoCodeCell }>();

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideCompletionItems(
		model: ITextModel,
		position: Position,
		context: CompletionContext,
		token: CancellationToken,
	): Promise<CompletionList | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const { cell, cellModel } = request;

		const cellPosition = toCellPosition(cell, position);
		const providers = this._languageFeaturesService.completionProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		if (providers.length === 0) {
			return undefined;
		}

		const lists = await Promise.all(providers.map(async provider => {
			const list = await invokeSafely(
				() => provider.provideCompletionItems(cellModel, cellPosition, context, token), this._logService);
			return list ? { provider, list } : undefined;
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

		return guardAgainstShadowCellUriLeaks('completion', {
			suggestions,
			incomplete,
			dispose: () => disposables.forEach(dispose => dispose()),
		}, this._logService);
	}

	async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
		const source = this._itemSources.get(item);
		if (!source?.provider.resolveCompletionItem) {
			return item;
		}
		const cell = source.cell;

		// The underlying provider produced (and resolves against) cell
		// coordinates, but `item` now carries document coordinates. Present it
		// in cell space for the round trip, then translate the result back.
		const cellItem = this._toCellSpace(cell, item);
		const resolved = await source.provider.resolveCompletionItem(cellItem, token);
		if (!resolved || token.isCancellationRequested) {
			return item;
		}
		this._translateSuggestion(cell, resolved);
		return guardAgainstShadowCellUriLeaks('completion resolve', resolved, this._logService) ?? item;
	}

	/** Translate a suggestion's ranges from cell to document space, in place. */
	private _translateSuggestion(cell: QuartoCodeCell, suggestion: CompletionItem): void {
		// A missing range is legal at this layer (the suggest infrastructure
		// fills in the default word range, computed against the .qmd model -
		// already document space).
		if (suggestion.range) {
			suggestion.range = Range.isIRange(suggestion.range)
				? toDocumentRange(cell, suggestion.range)
				: {
					insert: toDocumentRange(cell, suggestion.range.insert),
					replace: toDocumentRange(cell, suggestion.range.replace),
				};
		}
		if (suggestion.additionalTextEdits) {
			for (const edit of suggestion.additionalTextEdits) {
				edit.range = toDocumentRange(cell, edit.range);
			}
		}
	}

	/** Produce a shallow copy of an item with its ranges shifted to cell space. */
	private _toCellSpace(cell: QuartoCodeCell, item: CompletionItem): CompletionItem {
		const copy: CompletionItem = { ...item };
		if (copy.range) {
			copy.range = Range.isIRange(copy.range)
				? toCellRange(cell, copy.range)
				: {
					insert: toCellRange(cell, copy.range.insert),
					replace: toCellRange(cell, copy.range.replace),
				};
		}
		if (copy.additionalTextEdits) {
			copy.additionalTextEdits = copy.additionalTextEdits.map(edit => ({
				...edit,
				range: toCellRange(cell, edit.range),
			}));
		}
		return copy;
	}
}
