/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { CodeAction, CodeActionList, CodeActionProvider, CodeActionTriggerType, IWorkspaceTextEdit } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellUri } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoShadowCodeActionProvider } from '../../browser/quartoShadowCodeActionProvider.js';
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

/** The default invoke-triggered code action context. */
const invokeContext = { trigger: CodeActionTriggerType.Invoke };

describe('QuartoShadowCodeActionProvider', () => {
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

	function createProvider(): QuartoShadowCodeActionProvider {
		const bridge = ctx.instantiationService.createInstance(QuartoShadowLanguageBridge);
		return ctx.instantiationService.createInstance(QuartoShadowCodeActionProvider, bridge);
	}

	function registerCodeActions(provider: Partial<CodeActionProvider>): void {
		ctx.disposables.add(ctx.get(ILanguageFeaturesService).codeActionProvider.register(
			{ language: 'python' }, provider as CodeActionProvider));
	}

	it('forwards in-cell requests with a translated range', async () => {
		const content = qmd(['python', 'import os\nx = 1']);
		const { textModel, notebook } = createDocument(content);
		const provideCodeActions = vi.fn((): CodeActionList => ({ actions: [], dispose: () => { } }));
		registerCodeActions({ provideCodeActions });

		const requestLine = lineOf(content, 'x = 1');
		await createProvider().provideCodeActions(
			textModel, new Range(requestLine, 1, requestLine, 6), invokeContext, CancellationToken.None);

		const [forwardedModel, forwardedRange] = provideCodeActions.mock.calls[0] as unknown as [ITextModel, Range];
		expect({
			forwardedUri: forwardedModel.uri.toString(),
			forwardedRange: { ...forwardedRange },
		}).toEqual({
			forwardedUri: notebook.cells[0].uri.toString(),
			forwardedRange: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 6 },
		});
	});

	it('returns undefined in prose', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		registerCodeActions({ provideCodeActions: (): CodeActionList => ({ actions: [], dispose: () => { } }) });

		const proseLine = lineOf(content, 'Some prose.');
		const list = await createProvider().provideCodeActions(
			textModel, new Range(proseLine, 1, proseLine, 4), invokeContext, CancellationToken.None);
		expect(list).toBeUndefined();
	});

	it('rewrites workspace edits on shadow cells to the .qmd and passes other files through', async () => {
		const content = qmd(['python', 'import os\nx = 1']);
		const { textModel, notebook } = createDocument(content);
		registerCodeActions({
			provideCodeActions: (): CodeActionList => ({
				actions: [{
					title: 'Organize imports',
					edit: {
						edits: [
							{
								resource: notebook.cells[0].uri,
								textEdit: { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, text: 'import sys' },
								versionId: undefined,
							},
							{
								resource: URI.file('/other.py'),
								textEdit: { range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 1 }, text: 'pass' },
								versionId: undefined,
							},
						],
					},
				}],
				dispose: () => { },
			}),
		});

		const requestLine = lineOf(content, 'x = 1');
		const list = await createProvider().provideCodeActions(
			textModel, new Range(requestLine, 1, requestLine, 2), invokeContext, CancellationToken.None);

		const edits = list!.actions[0].edit!.edits as IWorkspaceTextEdit[];
		const importLine = lineOf(content, 'import os');
		expect(edits.map(edit => ({ resource: edit.resource.toString(), startLineNumber: edit.textEdit.range.startLineNumber }))).toEqual([
			{ resource: textModel.uri.toString(), startLineNumber: importLine },
			{ resource: URI.file('/other.py').toString(), startLineNumber: 5 },
		]);
	});

	it('drops edits on unmappable shadow cells instead of leaking them', async () => {
		const content = qmd(['python', 'x = 1']);
		const { textModel } = createDocument(content);
		const ghostCellUri = CellUri.generate(URI.file('/ghost.qmd'), 42);
		registerCodeActions({
			provideCodeActions: (): CodeActionList => ({
				actions: [{
					title: 'Ghost edit',
					edit: {
						edits: [{
							resource: ghostCellUri,
							textEdit: { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: 'y' },
							versionId: undefined,
						}],
					},
				}],
				dispose: () => { },
			}),
		});

		const requestLine = lineOf(content, 'x = 1');
		const list = await createProvider().provideCodeActions(
			textModel, new Range(requestLine, 1, requestLine, 2), invokeContext, CancellationToken.None);

		expect(list?.actions[0].edit?.edits).toEqual([]);
	});

	it('translates action diagnostics and ranges through the request cell', async () => {
		const content = qmd(['python', 'x = undefined_name']);
		const { textModel } = createDocument(content);
		registerCodeActions({
			provideCodeActions: (): CodeActionList => ({
				actions: [{
					title: 'Fix name',
					diagnostics: [{
						message: 'undefined name',
						severity: 8,
						startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 19,
					}],
					ranges: [{ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 19 }],
				}],
				dispose: () => { },
			}),
		});

		const requestLine = lineOf(content, 'undefined_name');
		const list = await createProvider().provideCodeActions(
			textModel, new Range(requestLine, 6, requestLine, 6), invokeContext, CancellationToken.None);

		const action = list!.actions[0];
		expect({
			diagnosticLine: action.diagnostics![0].startLineNumber,
			rangeLine: action.ranges![0].startLineNumber,
		}).toEqual({ diagnosticLine: requestLine, rangeLine: requestLine });
	});

	it('delegates resolveCodeAction and translates the filled-in edit', async () => {
		const content = qmd(['python', 'import os\nx = 1']);
		const { textModel, notebook } = createDocument(content);
		const action: CodeAction = { title: 'Lazy edit' };
		registerCodeActions({
			provideCodeActions: (): CodeActionList => ({ actions: [action], dispose: () => { } }),
			resolveCodeAction: (codeAction: CodeAction): CodeAction => {
				codeAction.edit = {
					edits: [{
						resource: notebook.cells[0].uri,
						textEdit: { range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 }, text: 'y' },
						versionId: undefined,
					}],
				};
				return codeAction;
			},
		});

		const provider = createProvider();
		const requestLine = lineOf(content, 'x = 1');
		const list = await provider.provideCodeActions(
			textModel, new Range(requestLine, 1, requestLine, 2), invokeContext, CancellationToken.None);
		const resolved = await provider.resolveCodeAction!(list!.actions[0], CancellationToken.None);

		const edit = resolved.edit!.edits[0] as IWorkspaceTextEdit;
		expect({
			resource: edit.resource.toString(),
			startLineNumber: edit.textEdit.range.startLineNumber,
		}).toEqual({ resource: textModel.uri.toString(), startLineNumber: requestLine });
	});
});
