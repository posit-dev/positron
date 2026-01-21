/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IQuartoExecutionManager } from './quartoExecutionManager.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { IQuartoOutputManager } from './quartoOutputManager.js';
import { IS_QUARTO_DOCUMENT, QUARTO_INLINE_OUTPUT_ENABLED } from '../common/positronQuartoConfig.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';

/**
 * Command IDs for Quarto execution commands.
 */
export const enum QuartoCommandId {
	RunCurrentCell = 'positronQuarto.runCurrentCell',
	RunCurrentCellAndAdvance = 'positronQuarto.runCurrentCellAndAdvance',
	RunAllCells = 'positronQuarto.runAllCells',
	RunCellsAbove = 'positronQuarto.runCellsAbove',
	RunCellsBelow = 'positronQuarto.runCellsBelow',
	CancelExecution = 'positronQuarto.cancelExecution',
	ClearAllOutputs = 'positronQuarto.clearAllOutputs',
	RestartKernel = 'positronQuarto.restartKernel',
	InterruptKernel = 'positronQuarto.interruptKernel',
}

/**
 * Category for Quarto commands.
 */
const QUARTO_CATEGORY = localize2('quarto.category', 'Quarto');

/**
 * Common precondition for Quarto commands: feature enabled and in a Quarto document.
 */
const QUARTO_PRECONDITION = ContextKeyExpr.and(
	QUARTO_INLINE_OUTPUT_ENABLED,
	IS_QUARTO_DOCUMENT
);

/**
 * Helper function to get the current Quarto document context.
 * Note: This function is synchronous to ensure proper use of ServicesAccessor.
 * The accessor is only valid during the synchronous portion of a command's run method.
 */
function getQuartoContext(editorService: IEditorService): {
	editor: ICodeEditor;
	textModel: ITextModel;
	documentUri: import('../../../../base/common/uri.js').URI;
} | undefined {
	const activeEditor = editorService.activeTextEditorControl;

	if (!activeEditor || !('getModel' in activeEditor)) {
		return undefined;
	}

	const editor = activeEditor as ICodeEditor;
	const textModel = editor.getModel();
	if (!textModel) {
		return undefined;
	}

	const uri = textModel.uri;
	if (!uri.path.endsWith('.qmd')) {
		return undefined;
	}

	return {
		editor,
		textModel,
		documentUri: uri,
	};
}

/**
 * Run the cell at the current cursor position.
 */
registerAction2(class RunCurrentCellAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RunCurrentCell,
			title: {
				value: localize('quarto.runCurrentCell', 'Run Current Cell'),
				original: 'Run Current Cell',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
			},
		});
	}

	async run(accessor: ServicesAccessor, lineNumber?: number): Promise<void> {
		// Extract all services synchronously before any async operations
		// The ServicesAccessor is only valid during the synchronous portion of this method
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const documentModelService = accessor.get(IQuartoDocumentModelService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor, textModel, documentUri } = context;

		// Get target line - use argument if provided, otherwise cursor position
		let targetLine = lineNumber;
		if (targetLine === undefined) {
			const position = editor.getPosition();
			if (!position) {
				return;
			}
			targetLine = position.lineNumber;
		}

		// Get the cell at target line
		const quartoModel = documentModelService.getModel(textModel);
		const cell = quartoModel.getCellAtLine(targetLine);

		if (cell) {
			await executionManager.executeCell(documentUri, cell);
		}
	}
});

/**
 * Run the current cell and advance cursor to the next cell.
 */
registerAction2(class RunCurrentCellAndAdvanceAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RunCurrentCellAndAdvance,
			title: {
				value: localize('quarto.runCurrentCellAndAdvance', 'Run Current Cell and Advance'),
				original: 'Run Current Cell and Advance',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift | KeyCode.Enter,
			},
		});
	}

	async run(accessor: ServicesAccessor, lineNumber?: number): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const documentModelService = accessor.get(IQuartoDocumentModelService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor, textModel, documentUri } = context;

		// Get target line - use argument if provided, otherwise cursor position
		let targetLine = lineNumber;
		if (targetLine === undefined) {
			const position = editor.getPosition();
			if (!position) {
				return;
			}
			targetLine = position.lineNumber;
		}

		// Get the cell at target line
		const quartoModel = documentModelService.getModel(textModel);
		const cell = quartoModel.getCellAtLine(targetLine);

		if (cell) {
			// Execute the cell
			await executionManager.executeCell(documentUri, cell);

			// Move to next cell
			const nextCell = quartoModel.getCellByIndex(cell.index + 1);
			if (nextCell) {
				editor.setPosition({
					lineNumber: nextCell.codeStartLine,
					column: 1,
				});
				editor.revealLineInCenter(nextCell.codeStartLine);
			}
		}
	}
});

/**
 * Run all cells in the document.
 */
registerAction2(class RunAllCellsAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RunAllCells,
			title: {
				value: localize('quarto.runAllCells', 'Run All Cells'),
				original: 'Run All Cells',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const documentModelService = accessor.get(IQuartoDocumentModelService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { textModel, documentUri } = context;

		const quartoModel = documentModelService.getModel(textModel);
		const cells = quartoModel.cells;

		if (cells.length > 0) {
			await executionManager.executeCells(documentUri, [...cells]);
		}
	}
});

/**
 * Run all cells above the cursor.
 */
registerAction2(class RunCellsAboveAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RunCellsAbove,
			title: {
				value: localize('quarto.runCellsAbove', 'Run Cells Above'),
				original: 'Run Cells Above',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor, lineNumber?: number): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const documentModelService = accessor.get(IQuartoDocumentModelService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor, textModel, documentUri } = context;

		// Get target line - use argument if provided, otherwise cursor position
		let targetLine = lineNumber;
		if (targetLine === undefined) {
			const position = editor.getPosition();
			if (!position) {
				return;
			}
			targetLine = position.lineNumber;
		}

		const quartoModel = documentModelService.getModel(textModel);
		const currentCell = quartoModel.getCellAtLine(targetLine);
		const currentIndex = currentCell?.index ?? quartoModel.cells.length;

		// Get all cells above (not including current)
		const cellsAbove = quartoModel.cells.filter(c => c.index < currentIndex);

		if (cellsAbove.length > 0) {
			await executionManager.executeCells(documentUri, cellsAbove);
		}
	}
});

/**
 * Run current cell and all cells below.
 */
registerAction2(class RunCellsBelowAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RunCellsBelow,
			title: {
				value: localize('quarto.runCellsBelow', 'Run Current Cell and Below'),
				original: 'Run Current Cell and Below',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor, lineNumber?: number): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const documentModelService = accessor.get(IQuartoDocumentModelService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor, textModel, documentUri } = context;

		// Get target line - use argument if provided, otherwise cursor position
		let targetLine = lineNumber;
		if (targetLine === undefined) {
			const position = editor.getPosition();
			if (!position) {
				return;
			}
			targetLine = position.lineNumber;
		}

		const quartoModel = documentModelService.getModel(textModel);
		const currentCell = quartoModel.getCellAtLine(targetLine);
		const currentIndex = currentCell?.index ?? 0;

		// Get current cell and all cells below
		const cellsBelow = quartoModel.cells.filter(c => c.index >= currentIndex);

		if (cellsBelow.length > 0) {
			await executionManager.executeCells(documentUri, cellsBelow);
		}
	}
});

/**
 * Cancel running or queued execution.
 */
registerAction2(class CancelExecutionAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.CancelExecution,
			title: {
				value: localize('quarto.cancelExecution', 'Cancel Execution'),
				original: 'Cancel Execution',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyC,
				mac: {
					primary: KeyMod.WinCtrl | KeyCode.KeyC,
				},
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		await executionManager.cancelExecution(documentUri);
	}
});

/**
 * Clear all inline outputs.
 */
registerAction2(class ClearAllOutputsAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ClearAllOutputs,
			title: {
				value: localize('quarto.clearAllOutputs', 'Clear All Outputs'),
				original: 'Clear All Outputs',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const outputManager = accessor.get(IQuartoOutputManager);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		// Clear execution state (cancels pending, clears running)
		executionManager.clearExecutionState(documentUri);

		// Clear all output view zones
		outputManager.clearAllOutputs(documentUri);
	}
});

/**
 * Restart the kernel for the current document.
 */
registerAction2(class RestartKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RestartKernel,
			title: {
				value: localize('quarto.restartKernel', 'Restart Kernel'),
				original: 'Restart Kernel',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const kernelManager = accessor.get(IQuartoKernelManager);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		await kernelManager.restartKernelForDocument(documentUri);
	}
});

/**
 * Interrupt the kernel for the current document.
 */
registerAction2(class InterruptKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.InterruptKernel,
			title: {
				value: localize('quarto.interruptKernel', 'Interrupt Kernel'),
				original: 'Interrupt Kernel',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.Escape,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const kernelManager = accessor.get(IQuartoKernelManager);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		kernelManager.interruptKernelForDocument(documentUri);
	}
});
