/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { MockNotebookCell } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { stubNotebookEditorServices } from '../../../../../test/vitest/presets/notebookEditor.js';
import { instantiateTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { ITextBuffer, ITextBufferFactory, ITextModel } from '../../../../../editor/common/model.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';

/**
 * Test subclass of PositronNotebookInstance that exposes disposable registration.
 * This allows test infrastructure to register disposables (editors, text models, etc.)
 * with the notebook's lifecycle.
 */
export class TestPositronNotebookInstance extends PositronNotebookInstance {
	instantiationService!: ITestInstantiationService;
}

/**
 * Creates an instantiation service for Positron notebook tests.
 * Equivalent to `createTestContainer().withNotebookEditorServices().build()`
 * -- prefer the builder in new tests. Kept for use by
 * `createTestPositronNotebookInstance()` below.
 */
export function positronNotebookInstantiationService(
	disposables: Pick<DisposableStore, 'add'>,
): ITestInstantiationService {
	const instantiationService = positronWorkbenchInstantiationService(disposables);
	stubNotebookEditorServices(instantiationService, disposables);
	return instantiationService;
}

let nextInstanceId = 0;

/**
 * A cell input that is either a MockNotebookCell tuple or a full ICellDto2 object.
 * Use ICellDto2 when you need to set fields that the tuple format does not
 * support, such as `mime`, `internalMetadata`, or `collapseState`.
 */
export type TestCellInput = MockNotebookCell | ICellDto2;

/**
 * Converts a TestCellInput to ICellDto2 format for NotebookTextModel.
 */
function cellToDto(cell: TestCellInput): ICellDto2 {
	if (!Array.isArray(cell)) { return cell; }
	const [source, language, cellKind, outputs, metadata] = cell;
	return {
		source,
		mime: undefined,
		language,
		cellKind,
		outputs: outputs || [],
		metadata: metadata || {},
		internalMetadata: {},
	};
}

/**
 * Creates a PositronNotebookInstance with editor-attached cells, suitable
 * for tests that need to exercise the notebook's observable state, cell
 * model, or view layer.
 *
 * Caller provides a test container built with `.withNotebookEditorServices()`
 * so the instantiation service and disposable store flow through to the
 * notebook instance.
 */
export function createTestPositronNotebookInstance(
	cells: TestCellInput[],
	ctx: { instantiationService: ITestInstantiationService; disposables: Pick<DisposableStore, 'add'> },
): TestPositronNotebookInstance {
	return instantiateTestNotebookInstance(cells, ctx.instantiationService, ctx.disposables);
}

/**
 * Creates an N-cell Python code notebook with cells labelled A, B, C, ...
 * Convenience wrapper over {@link createTestPositronNotebookInstance} for
 * tests that only care about cell ordering and identity, not content.
 */
export function createLabelledTestNotebook(
	n: number,
	ctx: { instantiationService: ITestInstantiationService; disposables: Pick<DisposableStore, 'add'> },
): TestPositronNotebookInstance {
	const labels = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
	return createTestPositronNotebookInstance(
		labels.map(v => [v, 'python', CellKind.Code]),
		ctx,
	);
}

/**
 * Lower-level factory: creates a PositronNotebookInstance using an existing
 * instantiation service. Editors are automatically attached to all cells
 * (initial and dynamically added).
 *
 * @param cells Array of cell data in shorthand format
 * @param instantiationService Pre-built service (from {@link positronNotebookInstantiationService})
 * @param disposables Store that owns service-lifetime disposables; the notebook
 *                    takes ownership via {@link TestPositronNotebookInstance.registerDisposable}.
 */
export function instantiateTestNotebookInstance(
	cells: TestCellInput[],
	instantiationService: ITestInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
): TestPositronNotebookInstance {
	// Create the notebook instance with a unique ID and URI so multiple
	// instances can coexist in the same ModelService without collisions.
	const id = nextInstanceId++;
	const viewType = 'jupyter-notebook';
	const uri = URI.parse(`test:///test/notebook-${id}.ipynb`);
	const notebook = disposables.add(instantiationService.createInstance(
		TestPositronNotebookInstance,
		uri,
		viewType,
		undefined, // creationOptions
	));
	notebook.instantiationService = instantiationService;

	// Create the notebook text model directly (before attachView, matching
	// PositronNotebookEditor.setInput production order).
	const cellDtos = cells.map((cell) => cellToDto(cell));
	const model = disposables.add(instantiationService.createInstance(
		NotebookTextModel,
		viewType,
		uri,
		cellDtos,
		{}, // metadata
		{
			transientCellMetadata: {},
			transientDocumentMetadata: {},
			cellContentMetadata: {},
			transientOutputs: false,
		}
	));
	notebook.setModel(model);

	// Attach view with DOM containers
	const editorContainer = document.createElement('div');
	const notebookContainer = document.createElement('div');
	const overlayContainer = document.createElement('div');
	editorContainer.appendChild(notebookContainer);
	editorContainer.appendChild(overlayContainer);
	const scopedContextKeyService = disposables.add(
		instantiationService.invokeFunction(accessor =>
			accessor.get(IContextKeyService)).createScoped(editorContainer)
	);
	notebook.attachView(editorContainer, scopedContextKeyService, notebookContainer, overlayContainer);

	// Auto-attach test editors to all cells (initial and dynamically added).
	// This mirrors what React's CellEditorMonacoWidget does in production.
	const attachedCells = new WeakSet<IPositronNotebookCell>();
	disposables.add(autorun(reader => {
		const currentCells = notebook.cells.read(reader);
		for (const cell of currentCells) {
			if (!attachedCells.has(cell)) {
				attachedCells.add(cell);
				const textModel = disposables.add(instantiationService.invokeFunction(createTestNotebookCellTextModel, cell));
				const editor = disposables.add(instantiateTestCodeEditor(instantiationService, textModel));
				cell.attachEditor(editor);
				// NotebookTextModel.onModelAdded automatically sets cell.model.textModel = textModel
			}
		}
	}));

	return notebook;
}

function createTestNotebookCellTextModel(accessor: ServicesAccessor, cell: IPositronNotebookCell): ITextModel {
	// Create text model directly from cell's textBuffer.
	const modelService = accessor.get(IModelService);
	const languageService = accessor.get(ILanguageService);
	const languageSelection = languageService.createById(
		languageService.getLanguageIdByLanguageName(cell.model.language) ?? PLAINTEXT_LANGUAGE_ID
	);

	// Reuse an existing model if the URI is already registered. This happens
	// when a deleted cell is restored via undo: a fresh IPositronNotebookCell
	// instance is created with the same URI as the original cell, and
	// ModelService throws if we try to add a second model for that URI.
	const existing = modelService.getModel(cell.uri);
	if (existing) {
		return existing;
	}

	const bufferFactory: ITextBufferFactory = {
		create: (_defaultEOL) => ({
			textBuffer: cell.model.textBuffer as ITextBuffer,
			disposable: Disposable.None,
		}),
		getFirstLineText: (limit: number) =>
			cell.model.textBuffer.getLineContent(1).substring(0, limit),
	};
	return modelService.createModel(bufferFactory, languageSelection, cell.uri);
}
