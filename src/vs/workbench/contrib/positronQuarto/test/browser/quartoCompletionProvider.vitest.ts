/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import {
	CompletionContext,
	CompletionItemKind,
	CompletionItemProvider,
	CompletionList,
	CompletionTriggerKind,
} from '../../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { LanguageFeatureRegistry } from '../../../../../editor/common/languageFeatureRegistry.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { QuartoCompletionProvider } from '../../browser/quartoCompletionProvider.js';
import { IQuartoCellModelService } from '../../browser/quartoCellModelService.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';

// A chunk whose code occupies document lines 5..8 (fences on 4 and 9).
const CELL: QuartoCodeCell = {
	id: 'c0', language: 'python', startLine: 4, endLine: 9,
	codeStartLine: 5, codeEndLine: 8, options: '', contentHash: '0', index: 0,
};

const CONTEXT: CompletionContext = { triggerKind: CompletionTriggerKind.Invoke };

/** Builds a fake language-server completion provider returning the given items in CELL space. */
function fakeProvider(...labels: string[]): CompletionItemProvider {
	return {
		_debugDisplayName: 'fake',
		provideCompletionItems: (): CompletionList => ({
			incomplete: false,
			suggestions: labels.map(label => ({
				label,
				kind: CompletionItemKind.Variable,
				insertText: label,
				// cell-space range on cell line 3 (== document line 7)
				range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 },
			})),
		}),
	};
}

/**
 * Constructs the provider with a cell at CELL, a stub cell model, and a
 * completion registry returning the given downstream providers.
 */
function setup(cellAtLine: QuartoCodeCell | undefined, downstream: CompletionItemProvider[]) {
	const documentModel = stubInterface<IQuartoDocumentModel>({ getCellAtLine: () => cellAtLine });
	const documentModelService = stubInterface<IQuartoDocumentModelService>({
		hasModel: () => true,
		getModelForUri: () => documentModel,
	});
	const cellModel = stubInterface<ITextModel>();
	const cellModelService = stubInterface<IQuartoCellModelService>({ getCellModel: () => cellModel });
	const completionProvider = stubInterface<LanguageFeatureRegistry<CompletionItemProvider>>({
		ordered: () => downstream,
	});
	const languageFeaturesService = stubInterface<ILanguageFeaturesService>({ completionProvider });

	const provider = new QuartoCompletionProvider(documentModelService, cellModelService, languageFeaturesService);
	const qmdModel = stubInterface<ITextModel>({ uri: URI.parse('file:///doc.qmd') });
	return { provider, qmdModel };
}

describe('QuartoCompletionProvider', () => {
	it('returns undefined for a position in prose (no cell)', async () => {
		const { provider, qmdModel } = setup(undefined, [fakeProvider('x')]);
		const result = await provider.provideCompletionItems(qmdModel, new Position(2, 1), CONTEXT, CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('returns undefined on a chunk fence line', async () => {
		const { provider, qmdModel } = setup(CELL, [fakeProvider('x')]);
		// Line 4 is the opening fence: inside the cell span but not code.
		const result = await provider.provideCompletionItems(qmdModel, new Position(4, 1), CONTEXT, CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('forwards into the cell and translates ranges back to document space', async () => {
		const { provider, qmdModel } = setup(CELL, [fakeProvider('numpy')]);
		const result = await provider.provideCompletionItems(qmdModel, new Position(7, 1), CONTEXT, CancellationToken.None);
		expect(result?.suggestions.map(s => ({ label: s.label, range: s.range }))).toEqual([
			{ label: 'numpy', range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 4 } },
		]);
	});

	it('merges suggestions from multiple downstream providers', async () => {
		const { provider, qmdModel } = setup(CELL, [fakeProvider('a'), fakeProvider('b', 'c')]);
		const result = await provider.provideCompletionItems(qmdModel, new Position(7, 1), CONTEXT, CancellationToken.None);
		expect(result?.suggestions.map(s => s.label)).toEqual(['a', 'b', 'c']);
	});
});
