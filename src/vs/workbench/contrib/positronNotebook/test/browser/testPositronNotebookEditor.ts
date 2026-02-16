/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { MockNotebookCell } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';

// Editor imports
import { instantiateTestCodeEditor, ITestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { IModelDecoration, ITextBuffer, ITextBufferFactory } from '../../../../../editor/common/model.js';
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
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';

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
 * Creates a TextModel directly from the cell's textBuffer, mirroring what
 * CellContentProvider.provideTextContent() does in production (notebook.contribution.ts:411-425)
 * but without going through the ITextModelService resolution chain which has
 * test service wiring issues.
 *
 * @param cell The notebook cell to attach the editor to
 * @param instantiationService The instantiation service (from withTestPositronNotebook)
 * @returns The test code editor
 */
export function attachTestEditorToCell(
	cell: IPositronNotebookCell,
	instantiationService: IInstantiationService,
): ITestCodeEditor {
	if (!(cell instanceof PositronNotebookCellGeneral)) {
		throw new Error('attachTestEditorToCell only supports PositronNotebookCellGeneral cells');
	}

	// Create text model directly from cell's textBuffer.
	const textModel = instantiationService.invokeFunction(accessor => {
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
		// NotebookTextModel.onModelAdded automatically sets cell.model.textModel = textModel
	});

	const editor = instantiateTestCodeEditor(instantiationService, textModel);
	editor.registerDisposable(textModel);
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
): ITestCodeEditor[] {
	return notebook.cells.get().map(cell =>
		attachTestEditorToCell(cell, instantiationService)
	);
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
