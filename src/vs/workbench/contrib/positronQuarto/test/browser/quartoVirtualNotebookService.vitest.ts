/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { NotebookProviderInfo } from '../../../notebook/common/notebookProvider.js';
import { QUARTO_NATIVE_LANGUAGE_FEATURES_KEY } from '../../common/positronQuartoConfig.js';
import { QUARTO_CELLS_SCHEME, QUARTO_CELLS_VIEW_TYPE } from '../../common/quartoVirtualNotebookTypes.js';
import { IQuartoDocumentModel } from '../../common/quartoTypes.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { QuartoVirtualNotebookService } from '../../browser/quartoVirtualNotebookService.js';

const R_AND_PYTHON = [
	'# Intro',
	'',
	'```{r}',
	'x <- 1',
	'```',
	'',
	'```{python}',
	'import os',
	'```',
	'',
].join('\n');

/**
 * Documents the churn test steps through, with the cells each one must produce.
 *
 * The line numbers are counted off the content beside them rather than derived
 * from the parser, so a wrong span shows up as a mismatch instead of agreeing
 * with whatever the code computed.
 */
const CHURN_STEPS: readonly {
	readonly name: string;
	readonly content: string;
	readonly cells: readonly (readonly [string, string, number, number])[];
}[] = [
		{
			name: 'one chunk',
			content: [
				'# Intro',			// 1
				'',					// 2
				'```{r}',			// 3
				'a <- 1',			// 4
				'```',				// 5
				'',
			].join('\n'),
			cells: [['r', 'a <- 1', 4, 4]],
		},
		{
			name: 'three chunks',
			content: [
				'# Intro',			// 1
				'',					// 2
				'```{r}',			// 3
				'a <- 1',			// 4
				'```',				// 5
				'',					// 6
				'```{r}',			// 7
				'b <- 2',			// 8
				'c <- 3',			// 9
				'```',				// 10
				'',					// 11
				'```{r}',			// 12
				'd <- 4',			// 13
				'```',				// 14
				'',
			].join('\n'),
			cells: [
				['r', 'a <- 1', 4, 4],
				['r', 'b <- 2\nc <- 3', 8, 9],
				['r', 'd <- 4', 13, 13],
			],
		},
		{
			name: 'two chunks',
			content: [
				'# Intro',			// 1
				'',					// 2
				'```{r}',			// 3
				'a <- 1',			// 4
				'```',				// 5
				'',					// 6
				'```{r}',			// 7
				'b <- 2',			// 8
				'c <- 3',			// 9
				'```',				// 10
				'',
			].join('\n'),
			cells: [
				['r', 'a <- 1', 4, 4],
				['r', 'b <- 2\nc <- 3', 8, 9],
			],
		},
		{
			// Same chunks, more prose above them: the cells move without changing.
			name: 'two chunks, more prose',
			content: [
				'# Intro',			// 1
				'',					// 2
				'more prose',		// 3
				'',					// 4
				'```{r}',			// 5
				'a <- 1',			// 6
				'```',				// 7
				'',					// 8
				'```{r}',			// 9
				'b <- 2',			// 10
				'c <- 3',			// 11
				'```',				// 12
				'',
			].join('\n'),
			cells: [
				['r', 'a <- 1', 6, 6],
				['r', 'b <- 2\nc <- 3', 10, 11],
			],
		},
		{
			// Same cell count and spans, different language in the first chunk.
			name: 'two chunks, first one Python',
			content: [
				'# Intro',			// 1
				'',					// 2
				'more prose',		// 3
				'',					// 4
				'```{python}',		// 5
				'a = 1',			// 6
				'```',				// 7
				'',					// 8
				'```{r}',			// 9
				'b <- 2',			// 10
				'c <- 3',			// 11
				'```',				// 12
				'',
			].join('\n'),
			cells: [
				['python', 'a = 1', 6, 6],
				['r', 'b <- 2\nc <- 3', 10, 11],
			],
		},
	];

describe('QuartoVirtualNotebookService', () => {
	const logService = new NullLogService();
	const configurationService = new TestConfigurationService();

	// The real NotebookService installs a process-global handler for the
	// `notebooks` extension point, so it cannot be rebuilt per test. This fake
	// covers the parts the service under test uses and hands out real
	// NotebookTextModels, which is what makes cell URI generation and the
	// IModelService binding real rather than simulated. Duplicate view type
	// registration throws exactly as the real store does, which is what the
	// registration guard has to survive.
	const notebooks = new ResourceMap<NotebookTextModel>();
	const contributedTypes = new Set<string>();
	// Annotated rather than inferred: createNotebookTextModel reads `ctx`, which
	// is built from this stub, and TypeScript cannot resolve that cycle on its own.
	const notebookService: INotebookService = stubInterface<INotebookService>({
		getNotebookTextModel: (uri: URI) => notebooks.get(uri),
		createNotebookTextModel: async (viewType: string, uri: URI): Promise<NotebookTextModel> => {
			const notebook = ctx.instantiationService.createInstance(
				NotebookTextModel, viewType, uri, [], {},
				{
					transientOutputs: true,
					transientCellMetadata: {},
					transientDocumentMetadata: {},
					cellContentMetadata: {},
				}
			);
			notebooks.set(uri, notebook);
			// The real service drops the model on disposal; without this the
			// fake would keep handing back a dead notebook.
			ctx.disposables.add(notebook.onWillDispose(() => notebooks.delete(uri)));
			return notebook;
		},
		getContributedNotebookType: (viewType: string) =>
			contributedTypes.has(viewType)
				? stubInterface<NotebookProviderInfo>({ id: viewType })
				: undefined,
		registerContributedNotebookType: (viewType: string): IDisposable => {
			if (contributedTypes.has(viewType)) {
				throw new Error(`notebook type '${viewType}' ALREADY EXISTS`);
			}
			contributedTypes.add(viewType);
			return toDisposable(() => contributedTypes.delete(viewType));
		},
		registerNotebookSerializer: (): IDisposable => Disposable.None,
	});

	// The real QuartoDocumentModelService keys models by text model, which is
	// exactly what the service under test consumes. Models are created lazily
	// here and torn down with the container.
	const documentModels = new Map<string, QuartoDocumentModel>();
	const documentModelService: Pick<IQuartoDocumentModelService, 'getModel'> = {
		getModel: (textModel: ITextModel): IQuartoDocumentModel => {
			const key = textModel.uri.toString();
			let model = documentModels.get(key);
			if (!model) {
				model = new QuartoDocumentModel(textModel, logService);
				documentModels.set(key, model);
			}
			return model;
		},
	};

	const ctx = createTestContainer()
		.withNotebookServices()
		.stub(INotebookService, notebookService)
		.stub(IConfigurationService, configurationService)
		.stub(IQuartoDocumentModelService, documentModelService)
		.build();

	beforeEach(async () => {
		contributedTypes.clear();
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, true);
	});

	afterEach(() => {
		for (const model of documentModels.values()) {
			model.dispose();
		}
		documentModels.clear();
		notebooks.clear();
	});

	function createService(): QuartoVirtualNotebookService {
		const service = ctx.instantiationService.createInstance(QuartoVirtualNotebookService);
		ctx.disposables.add(service);
		return service;
	}

	function createSourceModel(content: string, path = '/test/doc.qmd'): ITextModel {
		const modelService = ctx.instantiationService.get(IModelService);
		const languageService = ctx.instantiationService.get(ILanguageService);
		const model = modelService.createModel(
			content,
			languageService.createById('plaintext'),
			URI.file(path)
		);
		ctx.disposables.add(model);
		return model;
	}

	it('creates a hidden notebook whose URI keeps the source path', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const notebookUri = service.getNotebookUri(source.uri);
		const notebook = ctx.instantiationService.get(INotebookService)
			.getNotebookTextModel(notebookUri!);

		expect({
			scheme: notebookUri?.scheme,
			path: notebookUri?.path,
			viewType: notebook?.viewType,
			cellCount: notebook?.cells.length,
		}).toEqual({
			scheme: QUARTO_CELLS_SCHEME,
			path: source.uri.path,
			viewType: QUARTO_CELLS_VIEW_TYPE,
			cellCount: 2,
		});
	});

	it('creates one bound cell text model per code cell, holding only the code', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		expect(service.getCells(source.uri).map(cell => ({
			scheme: cell.cellUri.scheme,
			path: cell.cellUri.path,
			language: cell.language,
			text: cell.textModel.getValue(),
			codeStartLine: cell.codeStartLine,
			codeEndLine: cell.codeEndLine,
		}))).toEqual([
			{
				scheme: Schemas.vscodeNotebookCell,
				path: source.uri.path,
				language: 'r',
				text: 'x <- 1',
				codeStartLine: 4,
				codeEndLine: 4,
			},
			{
				scheme: Schemas.vscodeNotebookCell,
				path: source.uri.path,
				language: 'python',
				text: 'import os',
				codeStartLine: 8,
				codeEndLine: 8,
			},
		]);
	});

	it('binds each cell text model to its notebook cell', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const notebook = ctx.instantiationService.get(INotebookService)
			.getNotebookTextModel(service.getNotebookUri(source.uri)!);

		// The binding is what makes the extension host see real cell documents.
		expect(notebook!.cells.map(cell => cell.textModel?.uri.toString()))
			.toEqual(service.getCells(source.uri).map(cell => cell.cellUri.toString()));
	});

	it('does not create a notebook or register the type when the setting is off', async () => {
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, false);
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		expect({
			notebookUri: service.getNotebookUri(source.uri),
			// Registering the type writes to profile storage, so a user who
			// never enables the setting should accumulate nothing.
			typeRegistered: contributedTypes.has(QUARTO_CELLS_VIEW_TYPE),
		}).toEqual({
			notebookUri: undefined,
			typeRegistered: false,
		});
	});

	it('ignores documents that are not Quarto or R Markdown', async () => {
		const service = createService();
		const source = createSourceModel('x <- 1\n', '/test/script.R');
		await service.whenReady(source.uri);

		expect(service.getNotebookUri(source.uri)).toBeUndefined();
	});

	it('maps source lines to cells and back, treating prose as outside every cell', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const rCell = service.getCellAtLine(source.uri, 4);

		expect({
			prose: service.getCellAtLine(source.uri, 1)?.language,
			openingFence: service.getCellAtLine(source.uri, 3)?.language,
			rCode: service.getCellAtLine(source.uri, 4)?.language,
			closingFence: service.getCellAtLine(source.uri, 5)?.language,
			pythonCode: service.getCellAtLine(source.uri, 8)?.language,
			reverseLookup: service.getSourceUriForCell(rCell!.cellUri)?.toString(),
		}).toEqual({
			prose: undefined,
			openingFence: undefined,
			rCode: 'r',
			closingFence: undefined,
			pythonCode: 'python',
			reverseLookup: source.uri.toString(),
		});
	});

	it('edits cell text in place when only cell content changes', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const before = service.getCells(source.uri)[0];
		const beforeUri = before.cellUri.toString();
		const beforeHandle = before.handle;

		source.applyEdits([{
			range: { startLineNumber: 4, startColumn: 7, endLineNumber: 4, endColumn: 7 },
			text: '\ny <- 2',
		}]);
		service.ensureSynchronized(source.uri);

		const after = service.getCells(source.uri)[0];

		expect({
			text: after.textModel.getValue(),
			codeEndLine: after.codeEndLine,
			uriPreserved: after.cellUri.toString() === beforeUri,
			handlePreserved: after.handle === beforeHandle,
			modelPreserved: after.textModel === before.textModel,
		}).toEqual({
			text: 'x <- 1\ny <- 2',
			codeEndLine: 5,
			uriPreserved: true,
			handlePreserved: true,
			modelPreserved: true,
		});
	});

	it('rebuilds cells when a chunk is added, without leaving disposed models behind', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		source.setValue(R_AND_PYTHON + '```{r}\nmean(x)\n```\n');
		service.ensureSynchronized(source.uri);

		expect(service.getCells(source.uri).map(cell => ({
			text: cell.textModel.getValue(),
			disposed: cell.textModel.isDisposed(),
		}))).toEqual([
			{ text: 'x <- 1', disposed: false },
			{ text: 'import os', disposed: false },
			{ text: 'mean(x)', disposed: false },
		]);
	});

	it('tracks cell text and line spans through repeated churn', async () => {
		const service = createService();
		const source = createSourceModel(CHURN_STEPS[0].content);
		await service.whenReady(source.uri);

		// Three passes so every step is reached from more than one predecessor,
		// including the shrink direction that leaves cell models to dispose.
		for (let pass = 0; pass < 3; pass++) {
			for (const step of CHURN_STEPS) {
				source.setValue(step.content);
				// Wait for the debounced parse rather than forcing a sync. The
				// forced path runs the reconcile twice, and a second pass repairs
				// spans that the first one got wrong, hiding the bug from a
				// passive consumer who never asks for a sync.
				await documentModels.get(source.uri.toString())!.whenParsed();

				expect({
					step: step.name,
					cells: service.getCells(source.uri).map(cell =>
						[cell.language, cell.textModel.getValue(), cell.codeStartLine, cell.codeEndLine]),
					// Surprise F from the spike: cell models were disposed while
					// `_cells` still referenced them.
					allAlive: service.getCells(source.uri).every(cell => !cell.textModel.isDisposed()),
				}).toEqual({ step: step.name, cells: step.cells, allAlive: true });
			}
		}
	});

	it('keeps line spans fresh when prose above a chunk grows', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		// A prose-only edit changes no cell content, so the cell-level change
		// event stays silent while every chunk below shifts down. Syncing on that
		// event alone leaves the spans stale, which silently misplaces every
		// position mapped through a cell.
		source.applyEdits([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
			text: 'more prose\n\n',
		}]);
		await documentModels.get(source.uri.toString())!.whenParsed();

		// Read the way a passive consumer does, without asking for a sync first.
		expect(service.getCells(source.uri).map(cell => [cell.codeStartLine, cell.codeEndLine]))
			.toEqual([[6, 6], [10, 10]]);
	});

	it('disposes the notebook and its cell models when the source document closes', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const notebookUri = service.getNotebookUri(source.uri)!;
		const cellModels = service.getCells(source.uri).map(cell => cell.textModel);

		ctx.instantiationService.get(IModelService).destroyModel(source.uri);

		expect({
			notebookUri: service.getNotebookUri(source.uri),
			notebook: ctx.instantiationService.get(INotebookService).getNotebookTextModel(notebookUri),
			cells: service.getCells(source.uri),
			cellModelsDisposed: cellModels.map(model => model.isDisposed()),
		}).toEqual({
			notebookUri: undefined,
			notebook: undefined,
			cells: [],
			cellModelsDisposed: [true, true],
		});
	});

	it('tolerates the notebook type already being registered', async () => {
		// Surprise B from the spike: registerContributedNotebookType persists the
		// type to profile storage and rehydrates it on the next window, so a
		// second unconditional registration throws "ALREADY EXISTS". Registering
		// the type up front is what that second window looks like. The failure
		// was invisible in a single window and only appeared after a reload,
		// which is why this asserts the service still works rather than just
		// that construction did not throw.
		contributedTypes.add(QUARTO_CELLS_VIEW_TYPE);

		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		expect(service.getCells(source.uri).length).toBe(2);
	});

	it('drops the notebook when the setting is turned off', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, false);
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: () => true,
			affectedKeys: new Set([QUARTO_NATIVE_LANGUAGE_FEATURES_KEY]),
			source: 2,
			change: { keys: [QUARTO_NATIVE_LANGUAGE_FEATURES_KEY], overrides: [] },
		});
		await service.whenReady(source.uri);

		expect(service.getNotebookUri(source.uri)).toBeUndefined();
	});
});
