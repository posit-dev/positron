/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionItemRanges, CompletionList, CompletionTriggerKind } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoShadowCompletionProvider } from '../../browser/quartoShadowCompletionProvider.js';
import { QuartoShadowLanguageBridge } from '../../browser/quartoShadowLanguageBridge.js';
import { IQuartoShadowNotebookService } from '../../browser/quartoShadowNotebookService.js';
import { QuartoShadowNotebookSync } from '../../browser/quartoShadowNotebookSync.js';
import { QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE } from '../../common/quartoShadowNotebook.js';

function qmd(...cells: [language: string, code: string][]): string {
	const parts = ['---', 'title: test', '---', '', 'Some prose.', ''];
	for (const [language, code] of cells) {
		parts.push('```{' + language + '}', code, '```', '', 'More prose.', '');
	}
	return parts.join('\n');
}

/** 1-based line number of the first line containing `needle`. */
function lineOf(content: string, needle: string): number {
	const index = content.split('\n').findIndex(line => line.includes(needle));
	if (index < 0) {
		throw new Error(`No line contains: ${needle}`);
	}
	return index + 1;
}

/** The default invoke-triggered completion context. */
const invokeContext = { triggerKind: CompletionTriggerKind.Invoke };

describe('QuartoShadowCompletionProvider', () => {
	const documents = new Map<string, QuartoDocumentModel>();
	const shadows = new Map<string, { notebook: NotebookTextModel; sync: QuartoShadowNotebookSync }>();

	const ctx = createTestContainer().withWorkbenchServices()
		.stub(IQuartoDocumentModelService, {
			hasModel: (uri: URI) => documents.has(uri.toString()),
			getModelForUri: (uri: URI) => {
				const model = documents.get(uri.toString());
				if (!model) {
					throw new Error(`No document model for ${uri.toString()}`);
				}
				return model;
			},
		})
		.stub(IQuartoShadowNotebookService, {
			onDidAddShadowNotebook: Event.None,
			getShadowNotebook: (uri: URI) => shadows.get(uri.toString())?.notebook,
			getCellTextModel: (uri: URI, cellHandle: number) => {
				const entry = shadows.get(uri.toString());
				const cell = entry?.notebook.cells.find(c => c.handle === cellHandle);
				return entry && cell ? entry.sync.getOrCreateCellTextModel(cell) : undefined;
			},
		})
		.build();

	beforeEach(() => {
		documents.clear();
		shadows.clear();
		// See quartoShadowLanguageFeatures.vitest.ts: without a registration,
		// cell models fall back to plaintext and never match the stubs.
		ctx.disposables.add(ctx.get(ILanguageService).registerLanguage({ id: 'python' }));
		ctx.disposables.add(ctx.get(ILanguageService).registerLanguage({ id: 'r' }));
	});

	function createDocument(content: string, path = '/test.qmd') {
		const uri = URI.file(path);
		const textModel = ctx.disposables.add(createTextModel(content, null, undefined, uri));
		const documentModel = ctx.disposables.add(new QuartoDocumentModel(textModel, new NullLogService()));
		documents.set(uri.toString(), documentModel);
		const notebook: NotebookTextModel = ctx.disposables.add(ctx.instantiationService.createInstance(
			NotebookTextModel,
			QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE,
			uri,
			[],
			{},
			{ transientOutputs: true, transientCellMetadata: {}, transientDocumentMetadata: {}, cellContentMetadata: {} },
		));
		const sync = ctx.disposables.add(ctx.instantiationService.createInstance(QuartoShadowNotebookSync, documentModel, notebook));
		shadows.set(uri.toString(), { notebook, sync });
		return { uri, textModel, documentModel, notebook };
	}

	function createProvider(): QuartoShadowCompletionProvider {
		const bridge = ctx.instantiationService.createInstance(QuartoShadowLanguageBridge);
		return ctx.instantiationService.createInstance(QuartoShadowCompletionProvider, bridge);
	}

	function registerCompletions(
		language: string,
		provider: Pick<CompletionItemProvider, 'provideCompletionItems'> & Partial<CompletionItemProvider>,
	): void {
		ctx.disposables.add(ctx.get(ILanguageFeaturesService).completionProvider.register(
			{ language }, { _debugDisplayName: `stub-${language}`, ...provider }));
	}

	/** A one-suggestion completion list with ranges in cell space. */
	function cellSpaceSuggestion(label: string, overrides?: Partial<CompletionItem>): CompletionItem {
		return {
			label,
			kind: CompletionItemKind.Variable,
			insertText: label,
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
			...overrides,
		};
	}

	it('forwards in-cell requests with a translated position and maps suggestion ranges back', async () => {
		const content = qmd(['python', 'xy = 1\nx']);
		const { textModel, notebook } = createDocument(content);
		const provideCompletionItems = vi.fn((): CompletionList => ({
			suggestions: [cellSpaceSuggestion('xy', {
				range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
			})],
		}));
		registerCompletions('python', { provideCompletionItems });

		const requestLine = lineOf(content, 'x') + 1; // the lone 'x' on the cell's second line
		const list = await createProvider().provideCompletionItems(
			textModel, new Position(requestLine, 2), invokeContext, CancellationToken.None);

		const [forwardedModel, forwardedPosition] = provideCompletionItems.mock.calls[0] as unknown as [ITextModel, Position];
		expect({
			forwardedUri: forwardedModel.uri.toString(),
			forwardedPosition: { lineNumber: forwardedPosition.lineNumber, column: forwardedPosition.column },
			labels: list?.suggestions.map(s => s.label),
			range: list && { ...list.suggestions[0].range },
		}).toEqual({
			forwardedUri: notebook.cells[0].uri.toString(),
			forwardedPosition: { lineNumber: 2, column: 2 },
			labels: ['xy'],
			range: { startLineNumber: requestLine, startColumn: 1, endLineNumber: requestLine, endColumn: 2 },
		});
	});

	it('returns undefined in prose without invoking cell providers', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		const provideCompletionItems = vi.fn((): CompletionList => ({ suggestions: [cellSpaceSuggestion('nope')] }));
		registerCompletions('python', { provideCompletionItems });

		const list = await createProvider().provideCompletionItems(
			textModel, new Position(lineOf(content, 'Some prose.'), 3), invokeContext, CancellationToken.None);

		expect({ list, calls: provideCompletionItems.mock.calls.length }).toEqual({ list: undefined, calls: 0 });
	});

	it('translates insert/replace ranges and additionalTextEdits', async () => {
		const content = qmd(['python', 'import os\nos.pa']);
		const { textModel } = createDocument(content);
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({
				suggestions: [cellSpaceSuggestion('path', {
					range: {
						insert: { startLineNumber: 2, startColumn: 4, endLineNumber: 2, endColumn: 6 },
						replace: { startLineNumber: 2, startColumn: 4, endLineNumber: 2, endColumn: 6 },
					},
					additionalTextEdits: [{
						range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
						text: 'import os.path\n',
					}],
				})],
			}),
		});

		const requestLine = lineOf(content, 'os.pa');
		const list = await createProvider().provideCompletionItems(
			textModel, new Position(requestLine, 6), invokeContext, CancellationToken.None);

		const suggestion = list!.suggestions[0];
		const importLine = lineOf(content, 'import os');
		expect({
			insert: { ...(suggestion.range as CompletionItemRanges).insert },
			additionalEditLine: suggestion.additionalTextEdits![0].range.startLineNumber,
		}).toEqual({
			insert: { startLineNumber: requestLine, startColumn: 4, endLineNumber: requestLine, endColumn: 6 },
			additionalEditLine: importLine,
		});
	});

	it('leaves a missing range missing (the suggest widget computes the default word range on the .qmd)', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({
				// Providers may legally omit the range at runtime (the suggest
				// infrastructure fills the default); the core type is stricter.
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				suggestions: [{ label: 'bare', insertText: 'bare' } as CompletionItem],
			}),
		});

		const list = await createProvider().provideCompletionItems(
			textModel, new Position(lineOf(content, 'x = 1'), 1), invokeContext, CancellationToken.None);

		expect(list?.suggestions[0].range).toBeUndefined();
	});

	it('merges the lists of multiple providers, ORing incomplete and aggregating dispose', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		const disposeA = vi.fn();
		const disposeB = vi.fn();
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({
				suggestions: [cellSpaceSuggestion('alpha')], incomplete: false, dispose: disposeA,
			}),
		});
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({
				suggestions: [cellSpaceSuggestion('beta')], incomplete: true, dispose: disposeB,
			}),
		});

		const list = await createProvider().provideCompletionItems(
			textModel, new Position(lineOf(content, 'x = 1'), 1), invokeContext, CancellationToken.None);
		list!.dispose!();

		expect({
			labels: list?.suggestions.map(s => s.label).sort(),
			incomplete: list?.incomplete,
			disposed: [disposeA.mock.calls.length, disposeB.mock.calls.length],
		}).toEqual({ labels: ['alpha', 'beta'], incomplete: true, disposed: [1, 1] });
	});

	it('keeps requests going when one provider throws', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		registerCompletions('python', {
			provideCompletionItems: () => { throw new Error('boom'); },
		});
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({ suggestions: [cellSpaceSuggestion('survivor')] }),
		});

		const list = await createProvider().provideCompletionItems(
			textModel, new Position(lineOf(content, 'x = 1'), 1), invokeContext, CancellationToken.None);

		expect(list?.suggestions.map(s => s.label)).toEqual(['survivor']);
	});

	it('routes R and Python cells of one document to their own providers', async () => {
		const content = qmd(['python', 'x = 1'], ['r', 'y <- 2']);
		const { textModel } = createDocument(content);
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({ suggestions: [cellSpaceSuggestion('from_python')] }),
		});
		registerCompletions('r', {
			provideCompletionItems: (): CompletionList => ({ suggestions: [cellSpaceSuggestion('from_r')] }),
		});

		const provider = createProvider();
		const pythonList = await provider.provideCompletionItems(
			textModel, new Position(lineOf(content, 'x = 1'), 1), invokeContext, CancellationToken.None);
		const rList = await provider.provideCompletionItems(
			textModel, new Position(lineOf(content, 'y <- 2'), 1), invokeContext, CancellationToken.None);

		expect({
			python: pythonList?.suggestions.map(s => s.label),
			r: rList?.suggestions.map(s => s.label),
		}).toEqual({ python: ['from_python'], r: ['from_r'] });
	});

	it('round-trips resolveCompletionItem through the originating provider in cell space', async () => {
		const content = qmd(['python', 'xy = 1\nx']);
		const { textModel } = createDocument(content);
		const resolveCompletionItem = vi.fn((item: CompletionItem): CompletionItem => ({
			...item,
			documentation: 'resolved docs',
			additionalTextEdits: [{
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				text: 'import resolved\n',
			}],
		}));
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({
				suggestions: [cellSpaceSuggestion('xy', {
					range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
				})],
			}),
			resolveCompletionItem,
		});

		const provider = createProvider();
		const requestLine = lineOf(content, 'xy = 1') + 1;
		const list = await provider.provideCompletionItems(
			textModel, new Position(requestLine, 2), invokeContext, CancellationToken.None);
		const resolved = await provider.resolveCompletionItem!(list!.suggestions[0], CancellationToken.None);

		// The provider received the item back in CELL coordinates, and the
		// resolved additional edit came back in DOCUMENT coordinates.
		const received = resolveCompletionItem.mock.calls[0][0];
		expect({
			receivedRange: received.range && { ...received.range },
			documentation: resolved.documentation,
			resolvedEditLine: resolved.additionalTextEdits![0].range.startLineNumber,
		}).toEqual({
			receivedRange: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
			documentation: 'resolved docs',
			resolvedEditLine: lineOf(content, 'xy = 1'),
		});
	});

	it('returns the item unchanged when its provider has no resolve', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		registerCompletions('python', {
			provideCompletionItems: (): CompletionList => ({ suggestions: [cellSpaceSuggestion('plain')] }),
		});

		const provider = createProvider();
		const list = await provider.provideCompletionItems(
			textModel, new Position(lineOf(content, 'x = 1'), 1), invokeContext, CancellationToken.None);
		const item = list!.suggestions[0];

		expect(await provider.resolveCompletionItem!(item, CancellationToken.None)).toBe(item);
	});
});
