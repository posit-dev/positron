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
import { IMarkerData, IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../../platform/markers/common/markerService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { NotebookProviderInfo } from '../../../notebook/common/notebookProvider.js';
import { QUARTO_NATIVE_LANGUAGE_FEATURES_KEY } from '../../common/positronQuartoConfig.js';
import {
	QUARTO_CELLS_SCHEME,
	QUARTO_CELLS_VIEW_TYPE,
	QUARTO_EMBEDDED_DIAGNOSTICS_OWNER,
} from '../../common/quartoVirtualNotebookTypes.js';
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

/** A diagnostic as a language server would publish it against a cell. */
function marker(message: string): IMarkerData {
	return {
		severity: MarkerSeverity.Error,
		message,
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 5,
	};
}

describe('QuartoVirtualNotebookService', () => {
	const logService = new NullLogService();
	const configurationService = new TestConfigurationService();
	const markerService = new MarkerService();

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
		.stub(IMarkerService, markerService)
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
		for (const leftover of markerService.read({ ignoreResourceFilters: true })) {
			markerService.changeOne(leftover.owner, leftover.resource, []);
		}
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

	/**
	 * An untitled Quarto document, which is what _Quarto: New Document_ produces:
	 * a bare name with no `.qmd` on it, recognized by its language instead.
	 */
	function createUntitledSourceModel(content: string, path = 'Untitled-1'): ITextModel {
		const modelService = ctx.instantiationService.get(IModelService);
		const languageService = ctx.instantiationService.get(ILanguageService);
		// The Quarto extension contributes the `quarto` language, so nothing has
		// registered it here, and `createById` falls back to plaintext for an
		// unknown id. Without the language the document is unrecognizable: its
		// path is the other half of the check, and an untitled path has no
		// extension to go on.
		if (!languageService.isRegisteredLanguageId('quarto')) {
			ctx.disposables.add(languageService.registerLanguage({ id: 'quarto', extensions: ['.qmd'] }));
		}
		const model = modelService.createModel(
			content,
			languageService.createById('quarto'),
			URI.from({ scheme: Schemas.untitled, path })
		);
		ctx.disposables.add(model);
		return model;
	}

	it('creates a hidden notebook whose URI keeps the source path, under an .ipynb suffix', async () => {
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
			// The suffix is what makes a server willing to index the notebook at
			// all: ruff refuses any notebook whose path ends in anything else,
			// which would leave Python cells with no formatter and no linter.
			path: `${source.uri.path}.ipynb`,
			viewType: QUARTO_CELLS_VIEW_TYPE,
			cellCount: 2,
		});
	});

	it('gives an untitled document a Quarto path, so the URI says where its cells came from', async () => {
		const service = createService();
		const source = createUntitledSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		// A cell URI carries the path of the notebook it belongs to. Nothing gates
		// on that path any more, since a document selector matches these cells by
		// the notebook's type, but keeping the source extension is what makes a
		// cell URI in a log or a server trace say which document it belongs to.
		expect({
			sourcePath: source.uri.path,
			notebookPath: service.getNotebookUri(source.uri)?.path,
			cellPaths: service.getCells(source.uri).map(cell => cell.cellUri.path),
		}).toEqual({
			sourcePath: 'Untitled-1',
			notebookPath: 'Untitled-1.qmd.ipynb',
			cellPaths: ['Untitled-1.qmd.ipynb', 'Untitled-1.qmd.ipynb'],
		});
	});

	it('does not add a second Quarto extension to an untitled document that has one', async () => {
		const service = createService();
		const source = createUntitledSourceModel(R_AND_PYTHON, 'Untitled-1.qmd');
		await service.whenReady(source.uri);

		expect(service.getNotebookUri(source.uri)?.path).toBe('Untitled-1.qmd.ipynb');
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
				path: `${source.uri.path}.ipynb`,
				language: 'r',
				text: 'x <- 1',
				codeStartLine: 4,
				codeEndLine: 4,
			},
			{
				scheme: Schemas.vscodeNotebookCell,
				path: `${source.uri.path}.ipynb`,
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

	it('ignores read-only views of a Quarto document', async () => {
		// A Git diff or a local history entry has the same path but holds an older
		// revision. Giving one its own notebook would sync a second, stale copy of
		// the document to the language servers.
		const service = createService();
		const modelService = ctx.instantiationService.get(IModelService);
		const languageService = ctx.instantiationService.get(ILanguageService);
		const gitUri = URI.file('/test/doc.qmd').with({ scheme: 'git', query: '{"ref":"HEAD"}' });
		const gitModel = modelService.createModel(
			R_AND_PYTHON, languageService.createById('plaintext'), gitUri);
		ctx.disposables.add(gitModel);
		await service.whenReady(gitUri);

		expect({
			notebook: service.getNotebookUri(gitUri),
			cells: service.getAllCells().length,
		}).toEqual({ notebook: undefined, cells: 0 });
	});

	it('gives up its place when a notebook already exists for the document', async () => {
		// Left registered but without a notebook it would produce no cells forever,
		// and the guard against duplicates would stop it ever being retried.
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);
		const notebookUri = service.getNotebookUri(source.uri)!;

		// A second service over the same notebook map hits the existing model.
		const second = createService();
		await second.whenReady(source.uri);

		expect({
			firstStillWorks: service.getCells(source.uri).length,
			secondGaveUp: second.getNotebookUri(source.uri),
			notebookIntact: notebooks.get(notebookUri) !== undefined,
		}).toEqual({ firstStillWorks: 2, secondGaveUp: undefined, notebookIntact: true });
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

	it('keeps the existing cells when a chunk is appended', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const before = service.getCells(source.uri).map(cell => ({
			uri: cell.cellUri.toString(),
			handle: cell.handle,
			model: cell.textModel,
		}));

		source.setValue(R_AND_PYTHON + '```{r}\nmean(x)\n```\n');
		service.ensureSynchronized(source.uri);

		const after = service.getCells(source.uri);

		expect({
			text: after.map(cell => cell.textModel.getValue()),
			// Cell models can be disposed while `_cells` still reference them.
			allAlive: after.every(cell => !cell.textModel.isDisposed()),
			// The point of the splice: the two cells that did not change are the
			// same cells afterwards, so no language server sees a close and reopen.
			preserved: after.slice(0, 2).map((cell, index) => ({
				uri: cell.cellUri.toString() === before[index].uri,
				handle: cell.handle === before[index].handle,
				model: cell.textModel === before[index].model,
			})),
		}).toEqual({
			text: ['x <- 1', 'import os', 'mean(x)'],
			allAlive: true,
			preserved: [
				{ uri: true, handle: true, model: true },
				{ uri: true, handle: true, model: true },
			],
		});
	});

	it('keeps the surrounding cells when a chunk is inserted between two others', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const before = service.getCells(source.uri).map(cell => cell.textModel);

		// A new chunk between the existing R and Python ones. Everything below it
		// shifts index, which is what a rebuild would take as licence to replace.
		source.setValue([
			'# Intro',
			'',
			'```{r}',
			'x <- 1',
			'```',
			'',
			'```{r}',
			'mean(x)',
			'```',
			'',
			'```{python}',
			'import os',
			'```',
			'',
		].join('\n'));
		service.ensureSynchronized(source.uri);

		const after = service.getCells(source.uri);

		expect({
			text: after.map(cell => cell.textModel.getValue()),
			spans: after.map(cell => [cell.codeStartLine, cell.codeEndLine]),
			firstPreserved: after[0].textModel === before[0],
			// The Python cell moved from index 1 to index 2 and must still be the
			// same document to the language server that has it open.
			pythonPreserved: after[2].textModel === before[1],
			pythonAlive: !before[1].isDisposed(),
		}).toEqual({
			text: ['x <- 1', 'mean(x)', 'import os'],
			spans: [[4, 4], [8, 8], [12, 12]],
			firstPreserved: true,
			pythonPreserved: true,
			pythonAlive: true,
		});
	});

	it('disposes only the cell that was deleted', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const before = service.getCells(source.uri).map(cell => cell.textModel);

		// Drop the R chunk, keep the Python one.
		source.setValue([
			'# Intro',
			'',
			'```{python}',
			'import os',
			'```',
			'',
		].join('\n'));
		service.ensureSynchronized(source.uri);

		const after = service.getCells(source.uri);

		expect({
			text: after.map(cell => cell.textModel.getValue()),
			survivorPreserved: after[0].textModel === before[1],
			deletedDisposed: before[0].isDisposed(),
			survivorAlive: !before[1].isDisposed(),
		}).toEqual({
			text: ['import os'],
			survivorPreserved: true,
			deletedDisposed: true,
			survivorAlive: true,
		});
	});

	it('replaces only the cell whose language changed', async () => {
		// A cell's language is fixed when it is created, so this one genuinely has
		// to close and reopen. The cell beside it does not.
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const before = service.getCells(source.uri).map(cell => cell.textModel);

		source.setValue([
			'# Intro',
			'',
			'```{python}',
			'x = 1',
			'```',
			'',
			'```{python}',
			'import os',
			'```',
			'',
		].join('\n'));
		service.ensureSynchronized(source.uri);

		const after = service.getCells(source.uri);

		expect({
			languages: after.map(cell => cell.language),
			text: after.map(cell => cell.textModel.getValue()),
			changedCellReplaced: after[0].textModel !== before[0],
			oldModelDisposed: before[0].isDisposed(),
			untouchedCellPreserved: after[1].textModel === before[1],
		}).toEqual({
			languages: ['python', 'python'],
			text: ['x = 1', 'import os'],
			changedCellReplaced: true,
			oldModelDisposed: true,
			untouchedCellPreserved: true,
		});
	});

	it('does not expose a disposed cell while splicing', async () => {
		// The real ModelService fires onModelAdded synchronously and inline from
		// inside createModel, which _spliceCells calls to bind the inserted cell's
		// model. That call lands in the window between disposing the outgoing
		// cell's model and rebuilding `_cells`, so a listener woken by it, or by
		// anything else it triggers, is the closest thing to that bug in a test:
		// if `_cells` still held the disposed cell at that point, every getter
		// below would hand it back.
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);

		const modelService = ctx.instantiationService.get(IModelService);

		// Capture what the handler saw rather than asserting inside it: an
		// exception thrown inside an event handler can be swallowed by the
		// emitter instead of failing the test. Accumulate into an array rather
		// than a single variable: the regression this test guards has "several
		// cells inserted in one splice" as its natural shape, and with a single
		// variable a later successful invocation would overwrite an earlier
		// failure, silently defeating the test the moment a splice inserts more
		// than one cell. An empty array (the handler never ran at all) is itself
		// a failure, which the assertion below checks for.
		const observations: { cellAtLineFound: boolean; error: unknown }[] = [];
		const subscription = modelService.onModelAdded(() => {
			try {
				// Touch every cell the service hands back from its public getters,
				// the way a real consumer would. isDisposed() alone would not
				// reproduce the bug: it is a flag read, not the assertion that
				// throws "Model is disposed!" on a real access such as getValue().
				for (const cell of service.getCells(source.uri)) {
					cell.textModel.getValue();
				}
				for (const cell of service.getAllCells()) {
					cell.textModel.getValue();
				}
				// Optional chaining would let a transient window where the cell is
				// missing read as a pass, so a missing cell is its own recorded
				// observation instead of a silent skip.
				const atLine4 = service.getCellAtLine(source.uri, 4);
				if (atLine4) {
					atLine4.textModel.getValue();
				}
				observations.push({ cellAtLineFound: atLine4 !== undefined, error: undefined });
			} catch (error) {
				observations.push({ cellAtLineFound: false, error });
			}
		});
		ctx.disposables.add(subscription);

		// Changing the first chunk's language removes that cell and inserts a
		// replacement while the second cell survives untouched, so the splice has
		// both a removal and an insertion in the same pass. A pure append only
		// inserts and would never reach createModel with a removal already having
		// happened.
		source.setValue([
			'# Intro',
			'',
			'```{python}',
			'x = 1',
			'```',
			'',
			'```{python}',
			'import os',
			'```',
			'',
		].join('\n'));
		service.ensureSynchronized(source.uri);

		// A missing cell at line 4 during a transient window is not itself a
		// failure (the surviving cell's span has not been refreshed yet, and the
		// inserted cell is not spliced into `_cells` until every inserted model
		// in the splice has been created), so `cellAtLineFound` is recorded for
		// visibility rather than asserted true. What must hold for every
		// invocation is that no access threw: a disposed cell still reachable
		// through `_cells` is exactly what `error` would catch.
		expect(observations.length > 0).toBe(true);
		expect(observations.map(observation => observation.error)).toEqual(
			observations.map(() => undefined));
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

	it('excludes every cell it creates from the Problems pane', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);
		const [rCell] = service.getCells(source.uri);

		markerService.changeOne('ark', rCell.cellUri, [marker('object not found')]);

		// Nobody can open a cell URI, so an entry pointing at one is a dead end.
		// The diagnostics contribution shows these on the document instead, and
		// reads them with `ignoreResourceFilters` to get at them.
		expect({
			visible: markerService.read({ resource: rCell.cellUri }).length,
			raw: markerService.read({ resource: rCell.cellUri, ignoreResourceFilters: true })
				.map(m => m.message),
		}).toEqual({
			visible: 0,
			raw: ['object not found'],
		});
	});

	it('clears the markers of a spliced-out cell, under every owner, and stops excluding it', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);
		const [rCell] = service.getCells(source.uri);

		markerService.changeOne('ark', rCell.cellUri, [marker('from the language server')]);
		markerService.changeOne('lintr', rCell.cellUri, [marker('from a linter')]);

		// Drop the R chunk, keep the Python one.
		source.setValue([
			'# Intro',
			'',
			'```{python}',
			'import os',
			'```',
			'',
		].join('\n'));
		service.ensureSynchronized(source.uri);

		const cleared = markerService.read({ resource: rCell.cellUri, ignoreResourceFilters: true });
		// Nothing else would ever clear these: the marker service keeps markers
		// when a text model is disposed, and the extension that published them saw
		// its document close rather than its problems go away.
		markerService.changeOne('ark', rCell.cellUri, [marker('published after the cell died')]);

		expect({
			cleared: cleared.map(m => m.message),
			// Visible again, which is how a released exclusion shows: holding one
			// for every cell the document ever had would pile up all session.
			exclusionReleased: markerService.read({ resource: rCell.cellUri }).length,
		}).toEqual({
			cleared: [],
			exclusionReleased: 1,
		});
	});

	it('leaves no markers anywhere when the notebook is disposed', async () => {
		const service = createService();
		const source = createSourceModel(R_AND_PYTHON);
		await service.whenReady(source.uri);
		const cellUris = service.getCells(source.uri).map(cell => cell.cellUri);

		markerService.changeOne('ark', cellUris[0], [marker('r problem')]);
		markerService.changeOne('pyright', cellUris[1], [marker('python problem')]);
		// The remapped set, as the diagnostics contribution leaves it on the
		// document. The cells are about to go, so no republish can clear it.
		markerService.changeOne(
			QUARTO_EMBEDDED_DIAGNOSTICS_OWNER, source.uri, [marker('remapped problem')]);

		ctx.instantiationService.get(IModelService).destroyModel(source.uri);

		expect({
			cells: cellUris.flatMap(
				uri => markerService.read({ resource: uri, ignoreResourceFilters: true })),
			source: markerService.read({ resource: source.uri, ignoreResourceFilters: true }),
		}).toEqual({
			cells: [],
			source: [],
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

	// 75 steps at a 100ms parse debounce is about 7.5s of wall clock, against
	// the 60000ms timeout below: 8x headroom, so a loaded CI runner does not
	// flake. Fixing that headroom by forcing a sync instead of awaiting the
	// real debounce would defeat the point of the test (see the whenParsed
	// comment below), so the step count and timeout are what moved instead.
	it('matches a fresh parse after any sequence of chunk edits', async () => {
		// A deterministic generator, so a failure is reproducible from the seed
		// printed in the assertion below rather than being a one-off.
		let seed = 20260816;
		const random = (bound: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % bound;
		};

		const chunk = (language: string, code: string): string =>
			['```{' + language + '}', code, '```', ''].join('\n');

		// Chunks are drawn from a small pool on purpose: repeats are what make
		// duplicate content, and duplicate content is what a hash-keyed match
		// gets wrong.
		const pool = [
			chunk('r', 'a <- 1'),
			chunk('r', 'b <- 2'),
			chunk('r', 'a <- 1'),
			chunk('python', 'import os'),
			chunk('python', 'x = 1'),
		];

		const service = createService();
		const source = createSourceModel('# Intro\n\n');
		await service.whenReady(source.uri);

		const chunks: string[] = [];
		for (let step = 0; step < 75; step++) {
			// Insert, delete, or replace at a random position, so the splice sees
			// changes at both ends and in the middle rather than only appends.
			// The insert branch draws its position from chunks.length + 1 rather
			// than chunks.length, so an insert at the very end (append) is
			// reachable; delete and replace draw from chunks.length since those
			// need an existing index.
			const action = chunks.length === 0 ? 0 : random(3);
			const at = action === 0 ? random(chunks.length + 1) : random(chunks.length);
			if (action === 0) {
				chunks.splice(at, 0, pool[random(pool.length)]);
			} else if (action === 1) {
				chunks.splice(at, 1);
			} else {
				chunks[at] = pool[random(pool.length)];
			}

			source.setValue('# Intro\n\n' + chunks.join(''));
			await documentModels.get(source.uri.toString())!.whenParsed();

			const cells = service.getCells(source.uri);

			// The document model is the reference: whatever the edits did, the
			// cells have to agree with the same document model's own parsed
			// state, the state the service consumed to update them.
			const documentModel = documentModels.get(source.uri.toString())!;
			expect({
				step,
				seed,
				text: cells.map(cell => cell.textModel.getValue()),
				spans: cells.map(cell => [cell.codeStartLine, cell.codeEndLine]),
				languages: cells.map(cell => cell.language),
				anyDisposed: cells.some(cell => cell.textModel.isDisposed()),
			}).toEqual({
				step,
				seed,
				text: documentModel.cells.map(cell => documentModel.getCellCode(cell)),
				spans: documentModel.cells.map(cell => [cell.codeStartLine, cell.codeEndLine]),
				languages: documentModel.cells.map(cell => cell.language),
				anyDisposed: false,
			});
		}
	}, 60000);
});
