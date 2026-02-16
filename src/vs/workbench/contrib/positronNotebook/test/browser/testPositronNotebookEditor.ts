/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ICellDto2, NotebookData } from '../../../notebook/common/notebookCommon.js';
import { INotebookSerializer, INotebookService } from '../../../notebook/common/notebookService.js';
import { MockNotebookCell } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';

// Editor imports
import { instantiateTestCodeEditor, ITestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { IModelDecoration } from '../../../../../editor/common/model.js';
import { Selection } from '../../../../../editor/common/core/selection.js';

// Editor services required for TestCodeEditor
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
import { PositronNotebookCellGeneral } from '../../browser/PositronNotebookCells/PositronNotebookCell.js';
import { INotebookEditorModelResolverService } from '../../../notebook/common/notebookEditorModelResolverService.js';
import { CellContentProvider } from '../../../notebook/browser/notebook.contribution.js';
import { NotebookModelResolverServiceImpl } from '../../../notebook/common/notebookEditorModelResolverServiceImpl.js';

// ============================================================================
// Test Notebook Serializer
// ============================================================================

/**
 * Minimal serializer that returns pre-configured cells.
 * Registered with NotebookService so that createNotebookTextModel() works,
 * which in turn makes the notebook discoverable by CellContentProvider.
 */
class TestNotebookSerializer implements INotebookSerializer {
	readonly options = {
		transientCellMetadata: {},
		transientDocumentMetadata: {},
		cellContentMetadata: {},
		transientOutputs: false,
	};

	constructor(private readonly _cells: ICellDto2[]) { }

	async dataToNotebook(_data: VSBuffer): Promise<NotebookData> {
		return { cells: this._cells, metadata: {} };
	}

	async notebookToData(_data: NotebookData): Promise<VSBuffer> {
		return VSBuffer.fromString('');
	}

	async save(): Promise<never> { throw new Error('Not implemented'); }
	async searchInNotebooks(): Promise<never> { throw new Error('Not implemented'); }
}

// ============================================================================
// Instantiation Service
// ============================================================================

/**
 * Creates an instantiation service for Positron notebook tests.
 * Extends positronWorkbenchInstantiationService with editor services
 * required for attaching TestCodeEditor instances to cells.
 */
function positronNotebookInstantiationService(
	disposables: DisposableStore
): TestInstantiationService {
	const instantiationService = positronWorkbenchInstantiationService(disposables);

	// Add notebook services required for cell editor-related tests
	instantiationService.stub(INotebookEditorModelResolverService, disposables.add(instantiationService.createInstance(NotebookModelResolverServiceImpl)));
	// Register content provider so cell TextModels share the NotebookCellTextModel's buffer
	disposables.add(instantiationService.createInstance(CellContentProvider));

	// Add editor services required for TestCodeEditor
	instantiationService.stub(ICodeEditorService, disposables.add(instantiationService.createInstance(TestCodeEditorService)));
	instantiationService.stub(IEditorWorkerService, new TestEditorWorkerService());
	instantiationService.stub(ILanguageFeatureDebounceService, instantiationService.createInstance(LanguageFeatureDebounceService));
	instantiationService.stub(ILanguageFeaturesService, new LanguageFeaturesService());
	instantiationService.stub(ITreeSitterLibraryService, new TestTreeSitterLibraryService());

	return instantiationService;
}

// ============================================================================
// Notebook Test Harness
// ============================================================================

/**
 * Converts a MockNotebookCell tuple to ICellDto2 format for NotebookTextModel.
 */
function cellToDto(cell: MockNotebookCell): ICellDto2 {
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
 * Test utility for creating a PositronNotebookInstance with test infrastructure.
 *
 * @param cells Array of cell data in shorthand format
 * @param callback Test function that receives the notebook instance
 * @returns Result from the callback
 *
 * @example
 * ```typescript
 * await withTestPositronNotebook(
 *   [
 *     ['print("hello")', 'python', CellKind.Code],
 *     ['# Markdown', 'markdown', CellKind.Markup],
 *   ],
 *   async (notebook) => {
 *     const controller = PositronNotebookFindController.get(notebook);
 *     assert.ok(controller);
 *   }
 * );
 * ```
 */
export async function withTestPositronNotebook<R = unknown>(
	cells: MockNotebookCell[],
	callback: (
		notebook: IPositronNotebookInstance,
		instantiationService: TestInstantiationService,
	) => Promise<R> | R,
): Promise<R> {
	const disposables = new DisposableStore();

	try {
		// Use positronNotebookInstantiationService which includes editor services
		const instantiationService = positronNotebookInstantiationService(disposables);

		// Create the notebook instance
		const viewType = 'jupyter-notebook';
		const uri = URI.parse('test:///test/notebook.ipynb');
		const notebook = disposables.add(PositronNotebookInstance.getOrCreate(
			'test-unique-id',
			uri,
			viewType,
			undefined, // creationOptions
			instantiationService
		));

		// TODO: This is copy pasted from PositronNotebookEditor.tsx -- can we directly create an editor instead?
		//       or otherwise refactor to not need a dom node?...
		const editorContainer = document.createElement('div');
		const notebookContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		editorContainer.appendChild(notebookContainer);
		editorContainer.appendChild(overlayContainer);
		const scopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(editorContainer);
		notebook.attachView(editorContainer, scopedContextKeyService, notebookContainer, overlayContainer);

		// Register the notebook type and a dummy serializer so NotebookService can
		// create and track the model. This is required for CellContentProvider to
		// resolve cell URIs — it looks up the notebook via
		// NotebookService.getNotebookTextModel().
		const cellDtos = cells.map((cell) => cellToDto(cell));
		const notebookService = instantiationService.get(INotebookService);
		const extensionData = { id: new ExtensionIdentifier('test-extension'), location: undefined };
		disposables.add(notebookService.registerContributedNotebookType(viewType, {
			providerDisplayName: 'Test',
			displayName: 'Test Notebook',
			filenamePattern: ['*.ipynb'],
		}));
		disposables.add(notebookService.registerNotebookSerializer(
			viewType,
			extensionData,
			new TestNotebookSerializer(cellDtos),
		));
		const model = await notebookService.createNotebookTextModel(viewType, uri);
		disposables.add(model);
		notebook.setModel(model);

		// Run the test callback
		const result = await callback(notebook, instantiationService);

		return result;
	} finally {
		disposables.dispose();
	}
}

// ============================================================================
// Test Code Editor Attachment
// ============================================================================

/**
 * Attaches a test code editor to a notebook cell.
 * Creates a TextModel from the cell content and sets it on both the cell's
 * NotebookCellTextModel and the editor. This simulates the production behavior
 * where the text model is resolved when the cell editor is opened.
 *
 * @param cell The notebook cell to attach the editor to
 * @param instantiationService The instantiation service (from withTestPositronNotebook)
 * @returns The test code editor
 */
export async function attachTestEditorToCell(
	cell: IPositronNotebookCell,
	instantiationService: IInstantiationService,
): Promise<ITestCodeEditor> {
	// Create a text model from the cell's content
	// This simulates what happens in production when resolveTextModel is called
	// let textModel: ITextModel | null = cell.model.textModel ?? null;
	// if (!textModel) {
	// 	textModel = disposables.add(instantiateTextModel(
	// 		instantiationService,
	// 		cell.getContent(),
	// 		cell.model.language,
	// 		undefined,
	// 		cell.uri
	// 	));
	// 	// Set the text model on the cell's NotebookCellTextModel
	// 	// This is what production code does via ITextModelService.createModelReference
	// 	// but we need to instantiate a test text model
	// 	cell.model.textModel = textModel;
	// }

	if (!(cell instanceof PositronNotebookCellGeneral)) {
		throw new Error('attachTestEditorToCell only supports PositronNotebookCellGeneral cells');
	}
	const textModel = await cell.getTextEditorModel();

	// Create the editor with the text model
	const editor = instantiateTestCodeEditor(instantiationService, textModel);
	cell.attachEditor(editor);
	return editor;
}

/**
 * Attaches test code editors to all cells in a notebook.
 *
 * @param notebook The notebook instance
 * @param instantiationService The instantiation service
 * @returns Array of test code editors, one per cell (in cell order)
 */
export function attachTestEditorsToAllCells(
	notebook: IPositronNotebookInstance,
	instantiationService: IInstantiationService,
): Promise<ITestCodeEditor[]> {
	return Promise.all(notebook.cells.get().map(cell =>
		attachTestEditorToCell(cell, instantiationService)
	));
}

// ============================================================================
// Decoration Helpers
// ============================================================================

/**
 * Gets all decorations from a cell's text model.
 */
export function getDecorations(cell: IPositronNotebookCell): IModelDecoration[] {
	return cell.model.textModel?.getAllDecorations() ?? [];
}

/**
 * Gets find match decorations.
 */
export function getFindMatchDecorations(cell: IPositronNotebookCell): IModelDecoration[] {
	return getDecorations(cell).filter(d => d.options.className === 'findMatch');
}

/**
 * Gets the current find match decoration.
 */
export function getCurrentFindMatchDecoration(cell: IPositronNotebookCell): IModelDecoration | undefined {
	return getDecorations(cell).find(d => d.options.className === 'currentFindMatch');
}

// ============================================================================
// Selection Helpers
// ============================================================================

/**
 * Converts a Selection to array: [startLine, startCol, endLine, endCol]
 */
export function selectionToArray(selection: Selection): [number, number, number, number] {
	return [
		selection.startLineNumber,
		selection.startColumn,
		selection.endLineNumber,
		selection.endColumn
	];
}

/**
 * Gets the current selection from a cell's editor as an array.
 * Returns null if no editor or no selection.
 */
export function getCellSelection(cell: IPositronNotebookCell): [number, number, number, number] | null {
	const selection = cell.currentEditor?.getSelection();
	if (!selection) {
		return null;
	}
	return selectionToArray(selection);
}
