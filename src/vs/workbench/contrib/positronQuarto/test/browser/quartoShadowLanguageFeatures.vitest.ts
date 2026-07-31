/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Hover, Location } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellUri } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoShadowLanguageBridge } from '../../browser/quartoShadowLanguageBridge.js';
import {
	QuartoShadowDefinitionProvider,
	QuartoShadowDocumentHighlightProvider,
	QuartoShadowHoverProvider,
	QuartoShadowReferenceProvider,
	QuartoShadowSignatureHelpProvider,
} from '../../browser/quartoShadowLanguageFeatureProviders.js';
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

describe('Quarto shadow bridge providers', () => {
	/** Live per-test documents, keyed by URI; the service stubs read them. */
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
		// The materialized cell text models resolve their language through the
		// language service; without a registration they'd fall back to
		// plaintext and never match the { language: 'python' } stubs below.
		ctx.disposables.add(ctx.get(ILanguageService).registerLanguage({ id: 'python' }));
		ctx.disposables.add(ctx.get(ILanguageService).registerLanguage({ id: 'r' }));
	});

	/** Create a .qmd text model with a live document model and shadow notebook. */
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

	function createBridge(): QuartoShadowLanguageBridge {
		return ctx.instantiationService.createInstance(QuartoShadowLanguageBridge);
	}

	describe('hover', () => {
		function createHoverProvider() {
			return ctx.instantiationService.createInstance(QuartoShadowHoverProvider, createBridge());
		}

		it('forwards an in-cell request to the cell model with a translated position and maps the result range back', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel, notebook } = createDocument(content);
			const provideHover = vi.fn((): Hover => ({
				contents: [{ value: 'python hover' }],
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
			}));
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).hoverProvider.register(
				{ language: 'python' }, { provideHover }));

			const codeLine = lineOf(content, 'x = 1');
			const hover = await createHoverProvider().provideHover(textModel, new Position(codeLine, 3), CancellationToken.None);

			// The underlying provider saw the CELL model at cell coordinates.
			const [forwardedModel, forwardedPosition] = provideHover.mock.calls[0] as unknown as [ITextModel, Position];
			expect({
				forwardedUri: forwardedModel.uri.toString(),
				forwardedPosition: { lineNumber: forwardedPosition.lineNumber, column: forwardedPosition.column },
				contents: hover?.contents.map(c => c.value),
				range: hover?.range && { ...hover.range },
			}).toEqual({
				forwardedUri: notebook.cells[0].uri.toString(),
				forwardedPosition: { lineNumber: 1, column: 3 },
				contents: ['python hover'],
				range: { startLineNumber: codeLine, startColumn: 1, endLineNumber: codeLine, endColumn: 6 },
			});
		});

		it('returns undefined for prose without invoking cell providers', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel } = createDocument(content);
			const provideHover = vi.fn((): Hover => ({ contents: [{ value: 'nope' }] }));
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).hoverProvider.register(
				{ language: 'python' }, { provideHover }));

			const proseLine = lineOf(content, 'Some prose.');
			const hover = await createHoverProvider().provideHover(textModel, new Position(proseLine, 2), CancellationToken.None);

			expect({ hover, calls: provideHover.mock.calls.length }).toEqual({ hover: undefined, calls: 0 });
		});

		it('returns undefined on the fence lines (prose owned by the Quarto extension)', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel } = createDocument(content);
			const provider = createHoverProvider();

			const openFence = lineOf(content, '```{python}');
			const closeFence = openFence + 2;
			expect([
				await provider.provideHover(textModel, new Position(openFence, 2), CancellationToken.None),
				await provider.provideHover(textModel, new Position(closeFence, 2), CancellationToken.None),
			]).toEqual([undefined, undefined]);
		});

		it('routes each cell of a multi-language document to that language\'s providers', async () => {
			const content = qmd(['python', 'x = 1'], ['r', 'y <- 2']);
			const { textModel } = createDocument(content);
			const pythonHover = vi.fn((): Hover => ({ contents: [{ value: 'from python' }] }));
			const rHover = vi.fn((): Hover => ({ contents: [{ value: 'from r' }] }));
			const registry = ctx.get(ILanguageFeaturesService).hoverProvider;
			ctx.disposables.add(registry.register({ language: 'python' }, { provideHover: pythonHover }));
			ctx.disposables.add(registry.register({ language: 'r' }, { provideHover: rHover }));

			const provider = createHoverProvider();
			const rHoverResult = await provider.provideHover(
				textModel, new Position(lineOf(content, 'y <- 2'), 1), CancellationToken.None);
			const pythonHoverResult = await provider.provideHover(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);

			expect({
				r: rHoverResult?.contents.map(c => c.value),
				python: pythonHoverResult?.contents.map(c => c.value),
				pythonCalls: pythonHover.mock.calls.length,
				rCalls: rHover.mock.calls.length,
			}).toEqual({ r: ['from r'], python: ['from python'], pythonCalls: 1, rCalls: 1 });
		});

		it('merges the hovers of multiple cell providers into one', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel } = createDocument(content);
			const registry = ctx.get(ILanguageFeaturesService).hoverProvider;
			ctx.disposables.add(registry.register({ language: 'python' },
				{ provideHover: (): Hover => ({ contents: [{ value: 'one' }] }) }));
			ctx.disposables.add(registry.register({ language: 'python' },
				{ provideHover: (): Hover => ({ contents: [{ value: 'two' }] }) }));

			const hover = await createHoverProvider().provideHover(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);

			expect(hover?.contents.map(c => c.value).sort()).toEqual(['one', 'two']);
		});

		it('short-circuits to undefined when the setting is disabled, reading it live', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel } = createDocument(content);
			const provideHover = vi.fn((): Hover => ({ contents: [{ value: 'hi' }] }));
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).hoverProvider.register(
				{ language: 'python' }, { provideHover }));
			const provider = createHoverProvider();
			const position = new Position(lineOf(content, 'x = 1'), 1);
			const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;

			try {
				await configurationService.setUserConfiguration('quarto', { shadowNotebook: { enabled: false } });
				const disabled = await provider.provideHover(textModel, position, CancellationToken.None);
				expect({ disabled, calls: provideHover.mock.calls.length }).toEqual({ disabled: undefined, calls: 0 });

				// Re-enabling takes effect on the next request (no re-registration).
				await configurationService.setUserConfiguration('quarto', { shadowNotebook: { enabled: true } });
				const enabled = await provider.provideHover(textModel, position, CancellationToken.None);
				expect(enabled?.contents.map(c => c.value)).toEqual(['hi']);
			} finally {
				await configurationService.setUserConfiguration('quarto', {});
			}
		});

		it('returns undefined for a document without a shadow notebook', async () => {
			const content = qmd(['python', 'x = 1']);
			const { uri, textModel } = createDocument(content);
			shadows.delete(uri.toString());

			const hover = await createHoverProvider().provideHover(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);
			expect(hover).toBeUndefined();
		});

		it('drops a hover whose translation leaked a shadow cell URI (fail closed)', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel, notebook } = createDocument(content);
			// A markdown `uris` record carrying the raw cell URI is a leak the
			// per-field translation doesn't cover; the deep-scan guard must
			// drop the whole hover rather than surface it.
			const leakyHover: Hover = {
				contents: [{ value: 'leak', uris: { leak: notebook.cells[0].uri } }],
			};
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).hoverProvider.register(
				{ language: 'python' }, { provideHover: () => leakyHover }));

			const hover = await createHoverProvider().provideHover(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);
			expect(hover).toBeUndefined();
		});
	});

	describe('signature help', () => {
		it('forwards in-cell requests and passes the first result through', async () => {
			const content = qmd(['python', 'print(x)']);
			const { textModel, notebook } = createDocument(content);
			const signatureHelp = {
				value: { signatures: [{ label: 'print(x)', parameters: [] }], activeSignature: 0, activeParameter: 0 },
				dispose: () => { },
			};
			const provideSignatureHelp = vi.fn(() => signatureHelp);
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).signatureHelpProvider.register(
				{ language: 'python' }, { provideSignatureHelp }));

			const provider = ctx.instantiationService.createInstance(QuartoShadowSignatureHelpProvider, createBridge());
			const codeLine = lineOf(content, 'print(x)');
			const result = await provider.provideSignatureHelp(
				textModel, new Position(codeLine, 7), CancellationToken.None,
				{ triggerKind: 1, isRetrigger: false });

			const [forwardedModel, forwardedPosition] = provideSignatureHelp.mock.calls[0] as unknown as [ITextModel, Position];
			expect({
				forwardedUri: forwardedModel.uri.toString(),
				forwardedPosition: { lineNumber: forwardedPosition.lineNumber, column: forwardedPosition.column },
				label: result?.value.signatures[0].label,
			}).toEqual({
				forwardedUri: notebook.cells[0].uri.toString(),
				forwardedPosition: { lineNumber: 1, column: 7 },
				label: 'print(x)',
			});
		});

		it('returns undefined in prose', async () => {
			const content = qmd(['python', 'print(x)']);
			const { textModel } = createDocument(content);
			const provider = ctx.instantiationService.createInstance(QuartoShadowSignatureHelpProvider, createBridge());
			const result = await provider.provideSignatureHelp(
				textModel, new Position(lineOf(content, 'Some prose.'), 1), CancellationToken.None,
				{ triggerKind: 1, isRetrigger: false });
			expect(result).toBeUndefined();
		});
	});

	describe('definition', () => {
		it('maps same-document cell targets back to the .qmd and passes real files through', async () => {
			const content = qmd(['python', 'def helper():\n    pass'], ['python', 'value = helper()']);
			const { textModel, notebook } = createDocument(content);
			// The definition of `helper` (requested from cell 2) lives in cell 1
			// of the same document; a second location points at a real file.
			const cellOneUri = notebook.cells[0].uri;
			const locations: Location[] = [
				{ uri: cellOneUri, range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 11 } },
				{ uri: URI.file('/src/utils.py'), range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 7 } },
			];
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).definitionProvider.register(
				{ language: 'python' }, { provideDefinition: () => locations }));

			const provider = ctx.instantiationService.createInstance(QuartoShadowDefinitionProvider, createBridge());
			const result = await provider.provideDefinition(
				textModel, new Position(lineOf(content, 'value = helper()'), 10), CancellationToken.None);

			const defLine = lineOf(content, 'def helper');
			expect((result as Location[]).map(location => ({ uri: location.uri.toString(), range: { ...location.range } }))).toEqual([
				{
					uri: textModel.uri.toString(),
					range: { startLineNumber: defLine, startColumn: 5, endLineNumber: defLine, endColumn: 11 },
				},
				{
					uri: URI.file('/src/utils.py').toString(),
					range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 7 },
				},
			]);
		});

		it('maps cell targets of ANOTHER open .qmd back to that document', async () => {
			const contentA = qmd(['python', 'from lib import helper\nhelper()']);
			const contentB = qmd(['python', 'def helper():\n    pass']);
			const { textModel } = createDocument(contentA, '/a.qmd');
			const other = createDocument(contentB, '/b.qmd');
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).definitionProvider.register(
				{ language: 'python' }, {
				provideDefinition: (): Location[] => [{
					uri: other.notebook.cells[0].uri,
					range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 11 },
				}],
			}));

			const provider = ctx.instantiationService.createInstance(QuartoShadowDefinitionProvider, createBridge());
			const result = await provider.provideDefinition(
				textModel, new Position(lineOf(contentA, 'helper()'), 2), CancellationToken.None);

			const defLine = lineOf(contentB, 'def helper');
			expect((result as Location[]).map(location => ({ uri: location.uri.toString(), startLineNumber: location.range.startLineNumber }))).toEqual([
				{ uri: other.uri.toString(), startLineNumber: defLine },
			]);
		});

		it('drops unmappable shadow cell targets instead of leaking them', async () => {
			const content = qmd(['python', 'x = 1']);
			const { textModel } = createDocument(content);
			// A cell URI of a .qmd that has no shadow notebook can't be mapped.
			const ghostCellUri = CellUri.generate(URI.file('/ghost.qmd'), 99);
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).definitionProvider.register(
				{ language: 'python' }, {
				provideDefinition: (): Location[] => [
					{ uri: ghostCellUri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } },
					{ uri: URI.file('/keep.py'), range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } },
				],
			}));

			const provider = ctx.instantiationService.createInstance(QuartoShadowDefinitionProvider, createBridge());
			const result = await provider.provideDefinition(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);

			expect((result as Location[]).map(location => location.uri.toString())).toEqual([URI.file('/keep.py').toString()]);
		});

		it('translates LocationLink origin and target selection ranges', async () => {
			const content = qmd(['python', 'def helper():\n    pass\nresult = helper()']);
			const { textModel, notebook } = createDocument(content);
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).definitionProvider.register(
				{ language: 'python' }, {
				provideDefinition: () => [{
					uri: notebook.cells[0].uri,
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 9 },
					targetSelectionRange: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 11 },
					originSelectionRange: { startLineNumber: 3, startColumn: 10, endLineNumber: 3, endColumn: 16 },
				}],
			}));

			const provider = ctx.instantiationService.createInstance(QuartoShadowDefinitionProvider, createBridge());
			const callLine = lineOf(content, 'result = helper()');
			const result = await provider.provideDefinition(
				textModel, new Position(callLine, 11), CancellationToken.None);

			const defLine = lineOf(content, 'def helper');
			const [link] = result as import('../../../../../editor/common/languages.js').LocationLink[];
			expect({
				uri: link.uri.toString(),
				origin: link.originSelectionRange && { ...link.originSelectionRange },
				targetSelection: link.targetSelectionRange && { ...link.targetSelectionRange },
			}).toEqual({
				uri: textModel.uri.toString(),
				origin: { startLineNumber: callLine, startColumn: 10, endLineNumber: callLine, endColumn: 16 },
				targetSelection: { startLineNumber: defLine, startColumn: 5, endLineNumber: defLine, endColumn: 11 },
			});
		});
	});

	describe('references', () => {
		it('flattens results from all providers and maps cell locations back', async () => {
			const content = qmd(['python', 'x = 1'], ['python', 'print(x)']);
			const { textModel, notebook } = createDocument(content);
			const registry = ctx.get(ILanguageFeaturesService).referenceProvider;
			ctx.disposables.add(registry.register({ language: 'python' }, {
				provideReferences: (): Location[] => [{
					uri: notebook.cells[0].uri,
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
				}],
			}));
			ctx.disposables.add(registry.register({ language: 'python' }, {
				provideReferences: (): Location[] => [{
					uri: notebook.cells[1].uri,
					range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 },
				}],
			}));

			const provider = ctx.instantiationService.createInstance(QuartoShadowReferenceProvider, createBridge());
			const result = await provider.provideReferences(
				textModel, new Position(lineOf(content, 'x = 1'), 1),
				{ includeDeclaration: true }, CancellationToken.None);

			expect(result?.map(location => ({ uri: location.uri.toString(), line: location.range.startLineNumber })).sort((a, b) => a.line - b.line)).toEqual([
				{ uri: textModel.uri.toString(), line: lineOf(content, 'x = 1') },
				{ uri: textModel.uri.toString(), line: lineOf(content, 'print(x)') },
			]);
		});
	});

	describe('document highlights', () => {
		it('translates highlight ranges back to document space', async () => {
			const content = qmd(['python', 'x = 1\ny = x + x']);
			const { textModel } = createDocument(content);
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).documentHighlightProvider.register(
				{ language: 'python' }, {
				provideDocumentHighlights: () => [
					{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } },
					{ range: { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 6 } },
				],
			}));

			const provider = ctx.instantiationService.createInstance(QuartoShadowDocumentHighlightProvider, createBridge());
			const result = await provider.provideDocumentHighlights(
				textModel, new Position(lineOf(content, 'x = 1'), 1), CancellationToken.None);

			const firstCodeLine = lineOf(content, 'x = 1');
			expect(result?.map(highlight => ({ ...highlight.range }))).toEqual([
				{ startLineNumber: firstCodeLine, startColumn: 1, endLineNumber: firstCodeLine, endColumn: 2 },
				{ startLineNumber: firstCodeLine + 1, startColumn: 5, endLineNumber: firstCodeLine + 1, endColumn: 6 },
			]);
		});
	});
});
