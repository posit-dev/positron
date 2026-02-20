/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { MockNotebookCell } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { instantiateTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { ITextBuffer, ITextBufferFactory, ITextModel } from '../../../../../editor/common/model.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { TestCodeEditorService } from '../../../../../editor/test/browser/editorTestServices.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { TestEditorWorkerService } from '../../../../../editor/test/common/services/testEditorWorkerService.js';
import { ILanguageFeatureDebounceService, LanguageFeatureDebounceService } from '../../../../../editor/common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { LanguageFeaturesService } from '../../../../../editor/common/services/languageFeaturesService.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TestTreeSitterLibraryService } from '../../../../../editor/test/common/services/testTreeSitterLibraryService.js';
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
	instantiationService!: TestInstantiationService;
}

/**
 * Creates an instantiation service for Positron notebook tests.
 * Extends positronWorkbenchInstantiationService with editor services
 * required for attaching TestCodeEditor instances to cells.
 *
 * Exported so that multi-instance tests can share a single service
 * (avoiding disposable-tracking conflicts from duplicate global singletons).
 */
export function positronNotebookInstantiationService(
	disposables: Pick<DisposableStore, 'add'>,
): TestInstantiationService {
	const instantiationService = positronWorkbenchInstantiationService(disposables);

	// Add editor services required for TestCodeEditor
	instantiationService.stub(ICodeEditorService, disposables.add(instantiationService.createInstance(TestCodeEditorService)));
	instantiationService.stub(IEditorWorkerService, new TestEditorWorkerService());
	instantiationService.stub(ILanguageFeatureDebounceService, instantiationService.createInstance(LanguageFeatureDebounceService));
	instantiationService.stub(ILanguageFeaturesService, new LanguageFeaturesService());
	instantiationService.stub(ITreeSitterLibraryService, new TestTreeSitterLibraryService());

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
	if (Array.isArray(cell)) {
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
	return cell;
}

/**
 * Convenience function: creates both the instantiation service and the notebook
 * instance. Use this for single-instance tests.
 *
 * For multi-instance tests (where two notebooks must coexist), create a shared
 * service with {@link positronNotebookInstantiationService} and call
 * {@link instantiateTestNotebookInstance} directly.
 */
export function createTestPositronNotebookInstance(
	cells: TestCellInput[],
	disposables: Pick<DisposableStore, 'add'>,
): TestPositronNotebookInstance {
	const instantiationService = positronNotebookInstantiationService(disposables);
	const notebook = instantiateTestNotebookInstance(cells, instantiationService, disposables);
	return notebook;
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
	instantiationService: TestInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
): TestPositronNotebookInstance {
	// Create the notebook instance with a unique ID and URI so multiple
	// instances can coexist in the same ModelService without collisions.
	const id = nextInstanceId++;
	const viewType = 'jupyter-notebook';
	const uri = URI.parse(`test:///test/notebook-${id}.ipynb`);
	const notebook = disposables.add(instantiationService.createInstance(
		TestPositronNotebookInstance,
		`test-instance-${id}`,
		uri,
		viewType,
		undefined, // creationOptions
	));
	notebook.instantiationService = instantiationService;

	// Attach view with DOM containers
	const editorContainer = document.createElement('div');
	const notebookContainer = document.createElement('div');
	const overlayContainer = document.createElement('div');
	editorContainer.appendChild(notebookContainer);
	editorContainer.appendChild(overlayContainer);
	const scopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(editorContainer);
	notebook.attachView(editorContainer, scopedContextKeyService, notebookContainer, overlayContainer);

	// Create the notebook text model directly
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
