/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IQuartoExecutionManager, IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { IQuartoOutputManager, QuartoOutputContribution } from './quartoOutputManager.js';
import { IS_QUARTO_DOCUMENT, QUARTO_INLINE_OUTPUT_ENABLED, QUARTO_KERNEL_BUSY, QUARTO_KERNEL_RUNNING, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { selectNewLanguageRuntime } from '../../languageRuntime/browser/languageRuntimeActions.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Command IDs for Quarto execution commands.
 */
export const enum QuartoCommandId {
	CancelExecution = 'positronQuarto.cancelExecution',
	ClearAllOutputs = 'positronQuarto.clearAllOutputs',
	ClearOutputCache = 'positronQuarto.clearOutputCache',
	ShowOutputCache = 'positronQuarto.showOutputCache',
	StartKernel = 'positronQuarto.startKernel',
	RestartKernel = 'positronQuarto.restartKernel',
	InterruptKernel = 'positronQuarto.interruptKernel',
	ShutdownKernel = 'positronQuarto.shutdownKernel',
	ChangeKernel = 'positronQuarto.changeKernel',
	CopyOutput = 'positronQuarto.copyOutput',
	SaveCellPlot = 'positronQuarto.saveCellPlot',
	PopoutOutput = 'positronQuarto.popoutOutput',
	ExpandAllOutputs = 'positronQuarto.expandAllOutputs',
	CollapseAllOutputs = 'positronQuarto.collapseAllOutputs',
	ToggleOutputCollapse = 'positronQuarto.toggleOutputCollapse',
	RestartAndClearAllOutputs = 'positronQuarto.restartAndClearAllOutputs',
}

/**
 * Category for Quarto commands.
 */
const QUARTO_CATEGORY = localize2('quarto.category', "Quarto");

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
	const editor = editorService.activeTextEditorControl;

	if (!isCodeEditor(editor)) {
		return undefined;
	}

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
 * Cancel running or queued execution.
 */
registerAction2(class CancelExecutionAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.CancelExecution,
			title: {
				value: localize('quarto.cancelExecution', "Cancel Execution"),
				original: 'Cancel Execution',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			keybinding: {
				when: QUARTO_PRECONDITION,
				weight: KeybindingWeight.WorkbenchContrib,
				// On Mac, Ctrl+C is the traditional interrupt signal and does
				// not conflict with copy (Cmd+C). On Windows/Linux, Ctrl+C is
				// the copy shortcut, so we must not bind it there. Users can
				// still cancel execution via toolbar.
				primary: 0,
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
				value: localize('quarto.clearAllOutputs', "Clear All Outputs"),
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
 * Restart the kernel and clear all inline outputs in one step.
 * Useful when the user wants a clean slate: outputs disappear immediately
 * (mirroring ClearAllOutputs) and the kernel restarts in the background.
 */
registerAction2(class RestartAndClearAllOutputsAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.RestartAndClearAllOutputs,
			title: localize2('quarto.restartAndClearAllOutputs', "Restart Interpreter and Clear All Outputs"),
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(QUARTO_PRECONDITION, QUARTO_KERNEL_RUNNING),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const executionManager = accessor.get(IQuartoExecutionManager);
		const outputManager = accessor.get(IQuartoOutputManager);
		const kernelManager = accessor.get(IQuartoKernelManager);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		// Mirror ClearAllOutputs: cancel pending work and remove view zones up
		// front so the editor reflects the reset before the kernel comes back.
		executionManager.clearExecutionState(documentUri);
		outputManager.clearAllOutputs(documentUri);

		await kernelManager.restartKernelForDocument(documentUri);
	}
});

/**
 * Start the kernel for the current document explicitly. Shown when no kernel
 * is running so the user can start one directly (e.g. from a Quarto preview
 * editor) instead of having to run a cell or pin the tab.
 */
registerAction2(class StartKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.StartKernel,
			title: localize2('quarto.startKernel', "Start Kernel"),
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(QUARTO_PRECONDITION, QUARTO_KERNEL_RUNNING.negate()),
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: -10,
				when: QUARTO_KERNEL_RUNNING.negate(),
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

		await kernelManager.ensureKernelForDocument(documentUri);
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
				value: localize('quarto.restartKernel', "Restart Kernel"),
				original: 'Restart Kernel',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 10,
				// Only show for a running kernel; when nothing is running the
				// "Start Kernel" item covers starting one.
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
			title: localize2('quarto.interruptKernel', "Interrupt Kernel"),
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(QUARTO_PRECONDITION, QUARTO_KERNEL_BUSY),
			keybinding: {
				when: ContextKeyExpr.and(QUARTO_PRECONDITION, QUARTO_KERNEL_BUSY),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.Escape,
			},
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 20,
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
			title: localize2('quarto.shutdownKernel', "Shutdown Kernel"),
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
 * Change the kernel for the current Quarto document.
 */
registerAction2(class ChangeKernelAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ChangeKernel,
			title: localize2('quarto.changeKernel', "Change Kernel..."),
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(
				QUARTO_PRECONDITION,
				QUARTO_KERNEL_BUSY.negate()
			),
			menu: {
				id: MenuId.PositronQuartoKernelSubmenu,
				order: 0,
				when: QUARTO_KERNEL_BUSY.negate(),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const kernelManager = accessor.get(IQuartoKernelManager);
		// Resolved synchronously so we can re-enter a fresh accessor scope after
		// the awaits below (the run-method accessor is only valid synchronously).
		const instantiationService = accessor.get(IInstantiationService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { documentUri } = context;

		// Get the document's primary language to scope the picker.
		const language = await kernelManager.getDocumentLanguage(documentUri);
		if (!language) {
			return;
		}

		const currentRuntimeId = kernelManager.getSessionForDocument(documentUri)?.runtimeMetadata.runtimeId;

		const runtime = await instantiationService.invokeFunction(accessor =>
			selectNewLanguageRuntime(accessor, {
				title: localize('quarto.changeKernel.title', "Select Quarto Kernel"),
				languageId: language,
				currentRuntimeId,
			})
		);

		if (runtime && runtime.runtimeId !== currentRuntimeId) {
			// Fire and forget; the kernel state badge will show progress as
			// the old kernel shuts down and the new one starts up.
			kernelManager.changeKernelForDocument(documentUri, runtime.runtimeId);
		}
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
			title: localize2('quarto.copyOutput', "Copy Cell Output"),
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
			title: localize2('quarto.clearOutputCache', "Clear Inline Output Cache..."),
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
				localize('quarto.cacheEmpty.title', "Cache Empty"),
				localize('quarto.cacheEmpty.message', "The Quarto inline output cache is empty."),
				localize('quarto.ok', "OK")
			);
			return;
		}

		// Format the cache size
		const formattedSize = ByteSize.formatSize(cacheInfo.totalSizeBytes);

		// Show confirmation dialog
		const confirmed = await modalDialogsService.showSimpleModalDialogPrompt(
			localize('quarto.clearCache.title', "Clear Inline Output Cache"),
			localize(
				'quarto.clearCache.message',
				"The Quarto inline output cache is using {0} of storage ({1} files).\n\nOutputs from all documents will be removed. This action cannot be undone.",
				formattedSize,
				cacheInfo.fileCount
			),
			localize('quarto.clearCache.confirm', "Remove"),
			localize('quarto.cancel', "Cancel"),
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
					"Quarto inline output cache removed successfully ({0} files, {1})",
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
					"Quarto inline output cache partially cleared ({0} of {1} files removed). Some errors occurred:\n{2}",
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
			title: localize2('quarto.showOutputCache', "Show Output Cache"),
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
				localize('quarto.showOutputCache.noQuartoFile', "Open a Quarto file to view its output cache.")
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
					"No output cache exists for {0}. Run one or more cells in the document to create one.",
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
			title: localize2('quarto.saveCellPlot', "Save Cell Plot Output As..."),
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
			notificationService.warn(localize('quarto.saveCellPlot.noCursor', "No cursor position"));
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
			notificationService.warn(localize('quarto.saveCellPlot.noCell', "Cursor is not in a code cell"));
			return false;
		}

		// Get plot info for the cell at cursor position
		const plotInfo = contribution.getPlotInfoForCellAtLine(position.lineNumber);
		if (!plotInfo) {
			notificationService.warn(localize('quarto.saveCellPlot.noPlot', "No single plot output in this cell"));
			return false;
		}

		// Convert targetPath string to URI if provided (for testing)
		const targetUri = targetPath ? URI.file(targetPath) : undefined;

		// Save the plot
		return contribution.savePlot(plotInfo.dataUrl, plotInfo.mimeType, plotInfo.cellId, targetUri);
	}
});

/**
 * Open the output of the cell at the current cursor position in a new tab.
 * - PLOT outputs: Opens the image in a new editor tab
 * - TEXT outputs: Opens in a new untitled editor (ANSI stripped)
 * - HTML outputs: Opens in the Viewer pane
 */
registerAction2(class PopoutOutputAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.PopoutOutput,
			title: {
				value: localize('quarto.popoutOutput', 'Open Output in New Tab'),
				original: 'Open Output in New Tab',
			},
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor): Promise<boolean> {
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return false;
		}

		const { editor } = context;
		const position = editor.getPosition();
		if (!position) {
			notificationService.warn(localize('quarto.popoutOutput.noCursor', "No cursor position"));
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
			notificationService.warn(localize('quarto.popoutOutput.noCell', "Cursor is not in a code cell"));
			return false;
		}

		// Try to popout the output for the cell at cursor position
		const success = contribution.popoutForCellAtLine(position.lineNumber);
		if (!success) {
			notificationService.warn(localize('quarto.popoutOutput.noOutput', "No output available to open for this cell"));
			return false;
		}

		return true;
	}
});

/**
 * Expand all collapsed output view zones in the current Quarto document.
 */
registerAction2(class ExpandAllOutputsAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ExpandAllOutputs,
			title: localize2('quarto.expandAllOutputs', "Expand All Outputs"),
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

		const contribution = context.editor.getContribution<QuartoOutputContribution>(QuartoOutputContribution.ID);
		contribution?.setAllOutputsCollapsed(false);
	}
});

/**
 * Collapse all output view zones in the current Quarto document.
 */
registerAction2(class CollapseAllOutputsAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.CollapseAllOutputs,
			title: localize2('quarto.collapseAllOutputs', "Collapse All Outputs"),
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

		const contribution = context.editor.getContribution<QuartoOutputContribution>(QuartoOutputContribution.ID);
		contribution?.setAllOutputsCollapsed(true);
	}
});

/**
 * Toggle the collapsed state of the output view zone for the cell at the
 * current cursor position. No-op if the cursor is outside a code cell or
 * the cell has no output view zone.
 */
registerAction2(class ToggleOutputCollapseAction extends Action2 {
	constructor() {
		super({
			id: QuartoCommandId.ToggleOutputCollapse,
			title: localize2('quarto.toggleOutputCollapse', "Toggle Output Collapse"),
			category: QUARTO_CATEGORY,
			f1: true,
			precondition: QUARTO_PRECONDITION,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		const context = getQuartoContext(editorService);
		if (!context) {
			return;
		}

		const { editor } = context;
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		const contribution = editor.getContribution<QuartoOutputContribution>(QuartoOutputContribution.ID);
		if (!contribution) {
			return;
		}

		const toggled = contribution.toggleOutputCollapseForCellAtLine(position.lineNumber);
		if (!toggled) {
			notificationService.warn(localize('quarto.toggleOutputCollapse.noOutput', "No output to collapse or expand at the current position"));
		}
	}
});
