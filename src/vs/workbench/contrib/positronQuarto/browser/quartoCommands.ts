/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IQuartoExecutionManager, IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { IQuartoOutputManager } from './quartoOutputManager.js';
import { IS_QUARTO_DOCUMENT, QUARTO_INLINE_OUTPUT_ENABLED, QUARTO_KERNEL_RUNNING, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { QuartoOutputContribution } from './quartoOutputManager.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

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
	ClearOutputCache = 'positronQuarto.clearOutputCache',
	ShowOutputCache = 'positronQuarto.showOutputCache',
	RestartKernel = 'positronQuarto.restartKernel',
	InterruptKernel = 'positronQuarto.interruptKernel',
	ShutdownKernel = 'positronQuarto.shutdownKernel',
	ChangeKernel = 'positronQuarto.changeKernel',
	CopyOutput = 'positronQuarto.copyOutput',
	SaveCellPlot = 'positronQuarto.saveCellPlot',
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
	if (!isQuartoDocument(uri.path, textModel.getLanguageId())) {
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
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 10,
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
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 20,
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

/**
 * Shutdown the kernel for the current document.
 */
registerAction2(class ShutdownKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ShutdownKernel,
			title: {
				value: localize('quarto.shutdownKernel', 'Shutdown Kernel'),
				original: 'Shutdown Kernel',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(QUARTO_PRECONDITION, QUARTO_KERNEL_RUNNING),
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 30,
				when: QUARTO_KERNEL_RUNNING,
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

		await kernelManager.shutdownKernelForDocument(documentUri);
	}
});

/**
 * Change the kernel for the current document.
 */
registerAction2(class ChangeKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ChangeKernel,
			title: {
				value: localize('quarto.changeKernel', 'Change Kernel...'),
				original: 'Change Kernel...',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 0, // First item in menu (like notebooks)
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Extract all services synchronously before any async operations
		const editorService = accessor.get(IEditorService);
		const kernelManager = accessor.get(IQuartoKernelManager);
		const quickInputService = accessor.get(IQuickInputService);
		const languageRuntimeService = accessor.get(ILanguageRuntimeService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		// Get the document's current language from the kernel manager
		const currentSession = kernelManager.getSessionForDocument(documentUri);
		const currentLanguage = currentSession?.runtimeMetadata.languageId;

		// Get available runtimes for the current language or all languages
		const languages = currentLanguage ? [currentLanguage] : ['python', 'r'];
		const availableRuntimes = languageRuntimeService.registeredRuntimes
			.filter((runtime: ILanguageRuntimeMetadata) => languages.includes(runtime.languageId));

		if (availableRuntimes.length === 0) {
			return;
		}

		// Show quick pick
		const quickPick = quickInputService.createQuickPick<IQuickPickItem & { runtime?: ILanguageRuntimeMetadata }>();
		quickPick.title = localize('quarto.selectKernel.title', 'Select Quarto Kernel');
		quickPick.placeholder = localize('quarto.selectKernel.placeholder', 'Select an interpreter for this document');

		quickPick.items = availableRuntimes.map((runtime: ILanguageRuntimeMetadata) => ({
			label: runtime.runtimeName,
			description: runtime.languageName,
			detail: runtime.runtimePath,
			runtime,
			picked: currentSession?.runtimeMetadata.runtimeId === runtime.runtimeId,
		}));

		return new Promise<void>(resolve => {
			quickPick.onDidAccept(async () => {
				const selected = quickPick.selectedItems[0];
				if (selected?.runtime) {
					// Shutdown existing kernel if any
					await kernelManager.shutdownKernelForDocument(documentUri);

					// TODO: Start kernel with specific runtime
					// For now, restart to pick up the new preferred runtime
					// A more complete implementation would pass the selected runtime
					// to the kernel manager
					await kernelManager.ensureKernelForDocument(documentUri);
				}
				quickPick.hide();
				quickPick.dispose();
				resolve();
			});

			quickPick.onDidHide(() => {
				quickPick.dispose();
				resolve();
			});

			quickPick.show();
		});
	}
});

/**
 * Copy the output of the cell at the current cursor position.
 * Copies images if available, otherwise copies text content.
 */
registerAction2(class CopyOutputAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.CopyOutput,
			title: {
				value: localize('quarto.copyOutput', 'Copy Cell Output'),
				original: 'Copy Cell Output',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor } = context;
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		// Get the QuartoOutputContribution from the editor
		const contribution = editor.getContribution<QuartoOutputContribution>(QuartoOutputContribution.ID);
		if (!contribution) {
			return;
		}

		// Copy output for the cell at the cursor position
		contribution.copyOutputForCellAtLine(position.lineNumber);
	}
});

/**
 * Clear the entire Quarto inline output cache.
 * Shows a confirmation dialog before clearing.
 */
registerAction2(class ClearOutputCacheAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ClearOutputCache,
			title: {
				value: localize('quarto.clearOutputCache', 'Clear Inline Output Cache...'),
				original: 'Clear Inline Output Cache...',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_INLINE_OUTPUT_ENABLED,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const cacheService = accessor.get(IQuartoOutputCacheService);
		const modalDialogsService = accessor.get(IPositronModalDialogsService);
		const outputManager = accessor.get(IQuartoOutputManager);
		const notificationService = accessor.get(INotificationService);

		// Get cache info
		const cacheInfo = await cacheService.getCacheInfo();

		// If cache is empty, show a simple message
		if (cacheInfo.fileCount === 0) {
			await modalDialogsService.showSimpleModalDialogMessage(
				localize('quarto.cacheEmpty.title', 'Cache Empty'),
				localize('quarto.cacheEmpty.message', 'The Quarto inline output cache is empty.'),
				localize('quarto.ok', 'OK')
			);
			return;
		}

		// Format the cache size
		const formattedSize = ByteSize.formatSize(cacheInfo.totalSizeBytes);

		// Show confirmation dialog
		const confirmed = await modalDialogsService.showSimpleModalDialogPrompt(
			localize('quarto.clearCache.title', 'Clear Inline Output Cache'),
			localize(
				'quarto.clearCache.message',
				'The Quarto inline output cache is using {0} of storage ({1} files).\n\nOutputs from all documents will be removed. This action cannot be undone.',
				formattedSize,
				cacheInfo.fileCount
			),
			localize('quarto.clearCache.confirm', 'Remove'),
			localize('quarto.cancel', 'Cancel'),
			250 // height
		);

		if (!confirmed) {
			return;
		}

		// Clear all outputs from open documents first
		outputManager.clearAllOutputsGlobally();

		// Clear the cache
		const result = await cacheService.clearAllCaches();

		// Show result notification
		if (result.success) {
			const formattedFreed = ByteSize.formatSize(result.bytesFreed);
			notificationService.info(
				localize(
					'quarto.clearCache.success',
					'Quarto inline output cache removed successfully ({0} files, {1})',
					result.filesDeleted,
					formattedFreed
				)
			);
		} else {
			// Show warning with error summary
			const errorSummary = result.errors.length <= 3
				? result.errors.join('\n')
				: `${result.errors.slice(0, 3).join('\n')}\n... and ${result.errors.length - 3} more errors`;

			notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'quarto.clearCache.partial',
					'Quarto inline output cache partially cleared ({0} of {1} files removed). Some errors occurred:\n{2}',
					result.filesDeleted,
					cacheInfo.fileCount,
					errorSummary
				),
			});
		}
	}
});

/**
 * Show the ipynb output cache file for the current Quarto document.
 * Opens the cache file in preview mode using the default ipynb editor.
 */
registerAction2(class ShowOutputCacheAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ShowOutputCache,
			title: {
				value: localize('quarto.showOutputCache', 'Show Output Cache'),
				original: 'Show Output Cache',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_INLINE_OUTPUT_ENABLED,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const cacheService = accessor.get(IQuartoOutputCacheService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);

		// Get the current context
		const context = getQuartoContext(editorService);
		if (!context) {
			notificationService.info(
				localize('quarto.showOutputCache.noQuartoFile', 'Open a Quarto file to view its output cache.')
			);
			return;
		}

		const { documentUri } = context;

		// Get the cache path for this document
		const cachePath = cacheService.getCachePath(documentUri);

		// Check if the cache file exists
		const cacheExists = await fileService.exists(cachePath);
		if (!cacheExists) {
			const fileName = basename(documentUri);
			notificationService.info(
				localize(
					'quarto.showOutputCache.noCacheExists',
					'No output cache exists for {0}. Run one or more cells in the document to create one.',
					fileName
				)
			);
			return;
		}

		// Open the cache file in preview mode
		// Using pinned: false opens it as a preview tab
		await editorService.openEditor({
			resource: cachePath,
			options: {
				pinned: false,
				preserveFocus: false,
			}
		});
	}
});

/**
 * Save the plot output from the cell at the current cursor position.
 * Shows a file save dialog unless a target path is provided (for testing).
 */
registerAction2(class SaveCellPlotAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.SaveCellPlot,
			title: {
				value: localize('quarto.saveCellPlot', 'Save Cell Plot Output As...'),
				original: 'Save Cell Plot Output As...',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor, targetPath?: string): Promise<boolean> {
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return false;
		}

		const { editor } = context;
		const position = editor.getPosition();
		if (!position) {
			notificationService.warn(localize('quarto.saveCellPlot.noCursor', 'No cursor position'));
			return false;
		}

		// Get the QuartoOutputContribution from the editor
		const contribution = editor.getContribution<QuartoOutputContribution>(QuartoOutputContribution.ID);
		if (!contribution) {
			return false;
		}

		// Check if cursor is in a cell
		const cellId = contribution.getCellIdAtLine(position.lineNumber);
		if (!cellId) {
			notificationService.warn(localize('quarto.saveCellPlot.noCell', 'Cursor is not in a code cell'));
			return false;
		}

		// Get plot info for the cell at cursor position
		const plotInfo = contribution.getPlotInfoForCellAtLine(position.lineNumber);
		if (!plotInfo) {
			notificationService.warn(localize('quarto.saveCellPlot.noPlot', 'No single plot output in this cell'));
			return false;
		}

		// Convert targetPath string to URI if provided (for testing)
		const targetUri = targetPath ? URI.file(targetPath) : undefined;

		// Save the plot
		return contribution.savePlot(plotInfo.dataUrl, plotInfo.mimeType, plotInfo.cellId, targetUri);
	}
});
