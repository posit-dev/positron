/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupIdentifier, GroupModelChangeKind } from '../../../common/editor.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { registerEditorContribution, EditorContributionInstantiation } from '../../../../editor/browser/editorExtensions.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { QuartoDocumentModelService, IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoKernelManager, IQuartoKernelManager } from './quartoKernelManager.js';
import { QuartoExecutionManager, IQuartoExecutionManager } from './quartoExecutionManager.js';
import { QuartoOutputManagerService, QuartoOutputContribution, IQuartoOutputManager } from './quartoOutputManager.js';
import { QuartoOutputCacheService } from './quartoOutputCacheService.js';
import { IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { QuartoExecutionDecorations } from './quartoExecutionDecorations.js';
import { QuartoCellToolbarController } from './quartoCellToolbarController.js';
import { QuartoImagePreviewContribution } from './quartoImagePreview.js';
import { QuartoEquationPreviewContribution } from './quartoEquationPreview.js';
import {
	IS_QUARTO_DOCUMENT,
	POSITRON_QUARTO_INLINE_OUTPUT_KEY,
	QUARTO_INLINE_OUTPUT_ENABLED,
	QUARTO_KERNEL_BUSY,
	QUARTO_KERNEL_RUNNING,
	QUARTO_LANGUAGE_IDS,
	isQuartoDocument,
	isQuartoOrRmdFile,
} from '../common/positronQuartoConfig.js';
import { QuartoKernelState } from './quartoKernelManager.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { QuartoKernelStatusBadge } from './QuartoKernelStatusBadge.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';

// Import the configuration to ensure it's registered
import '../common/positronQuartoConfig.js';

// Import commands to ensure they're registered
import './quartoCommands.js';

// Import editor action bar menu wiring to ensure it's registered
import './quartoEditorActionBar.js';

// Import CSS styles
import './media/quartoExecutionDecorations.css';
import './media/quartoOutputViewZone.css';
import './media/quartoToolbar.css';
import './media/quartoImagePreview.css';
import './media/quartoEquationPreview.css';

// Register services
registerSingleton(IQuartoDocumentModelService, QuartoDocumentModelService, InstantiationType.Delayed);
registerSingleton(IQuartoKernelManager, QuartoKernelManager, InstantiationType.Delayed);
registerSingleton(IQuartoExecutionManager, QuartoExecutionManager, InstantiationType.Delayed);
registerSingleton(IQuartoOutputCacheService, QuartoOutputCacheService, InstantiationType.Delayed);
registerSingleton(IQuartoOutputManager, QuartoOutputManagerService, InstantiationType.Delayed);

// Register editor contributions
registerEditorContribution(QuartoExecutionDecorations.ID, QuartoExecutionDecorations, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoOutputContribution.ID, QuartoOutputContribution, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoCellToolbarController.ID, QuartoCellToolbarController, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoImagePreviewContribution.ID, QuartoImagePreviewContribution, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoEquationPreviewContribution.ID, QuartoEquationPreviewContribution, EditorContributionInstantiation.AfterFirstRender);

/**
 * Extension ID for the Quarto extension.
 * The inline output feature requires this extension to be installed.
 */
const QUARTO_EXTENSION_ID = 'quarto.quarto';

/**
 * Contribution that manages Quarto inline output functionality.
 * Responsible for:
 * - Tracking context keys for Quarto documents
 * - Updating context keys when editor or configuration changes
 */
class QuartoInlineOutputContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoInlineOutput';

	private readonly _isQuartoDocumentKey = IS_QUARTO_DOCUMENT.bindTo(this._contextKeyService);
	private readonly _inlineOutputEnabledKey = QUARTO_INLINE_OUTPUT_ENABLED.bindTo(this._contextKeyService);
	private readonly _kernelRunningKey = QUARTO_KERNEL_RUNNING.bindTo(this._contextKeyService);
	private readonly _kernelBusyKey = QUARTO_KERNEL_BUSY.bindTo(this._contextKeyService);

	/** Tracks documents that have already had auto-start attempted, so we only auto-start on first focus. */
	private readonly _autoStartedDocuments = new Set<string>();

	/** Per-group EDITOR_PIN listener disposables, keyed by group ID. */
	private readonly _groupListeners = new Map<GroupIdentifier, DisposableStore>();

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IQuartoKernelManager private readonly _quartoKernelManager: IQuartoKernelManager,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
	) {
		super();

		// Initialize context keys
		this._updateInlineOutputEnabled();
		this._updateIsQuartoDocument();
		this._updateKernelRunning();

		// Listen for configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._updateInlineOutputEnabled();
			}
		}));

		// Listen for active editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._updateIsQuartoDocument();
			this._updateKernelRunning();
			this._autoStartKernelIfActiveAndPinned();
		}));

		// Listen for kernel state changes
		this._register(this._quartoKernelManager.onDidChangeKernelState(() => {
			this._updateKernelRunning();
		}));

		// Listen for extension changes (install/uninstall)
		this._register(this._extensionService.onDidChangeExtensions(() => {
			this._updateInlineOutputEnabled();
		}));

		// Clear auto-start tracking when a Quarto document is closed,
		// so reopening it will trigger auto-start again.
		this._register(this._editorService.onDidCloseEditor(e => {
			const uri = e.editor.resource;
			if (uri) {
				this._autoStartedDocuments.delete(uri.toString());
			}
		}));

		// Watch for preview-to-pinned transitions on each editor group so a
		// preview tab that the user upgrades (typing, executing, double-click,
		// drag, etc.) starts its kernel.
		this._register(this._editorGroupsService.onDidAddGroup(group => this._registerGroupListener(group)));
		this._register(this._editorGroupsService.onDidRemoveGroup(group => {
			this._groupListeners.get(group.id)?.dispose();
			this._groupListeners.delete(group.id);
		}));
		for (const group of this._editorGroupsService.groups) {
			this._registerGroupListener(group);
		}

		// After the runtime startup phase completes (reconnection finished),
		// auto-start the kernel for the active Quarto document if it's pinned.
		// Background tabs and preview editors do NOT get a kernel until the
		// user focuses or pins them.
		if (this._languageRuntimeService.startupPhase === RuntimeStartupPhase.Complete) {
			this._autoStartKernelIfActiveAndPinned();
		} else {
			this._register(this._languageRuntimeService.onDidChangeRuntimeStartupPhase(phase => {
				if (phase === RuntimeStartupPhase.Complete) {
					this._autoStartKernelIfActiveAndPinned();
				}
			}));
		}
	}

	override dispose(): void {
		for (const disposables of this._groupListeners.values()) {
			disposables.dispose();
		}
		this._groupListeners.clear();
		super.dispose();
	}

	private _registerGroupListener(group: IEditorGroup): void {
		if (this._groupListeners.has(group.id)) {
			return;
		}
		const disposables = new DisposableStore();
		this._groupListeners.set(group.id, disposables);
		disposables.add(group.onDidModelChange(e => {
			if (e.kind === GroupModelChangeKind.EDITOR_PIN && e.editor) {
				this._maybeAutoStartKernelForEditor(e.editor);
			}
		}));
		disposables.add(group.onWillDispose(() => {
			disposables.dispose();
			this._groupListeners.delete(group.id);
		}));
	}

	private _updateInlineOutputEnabled(): void {
		const settingEnabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		if (!settingEnabled) {
			// If the setting is disabled, the feature is disabled regardless of extension status
			this._inlineOutputEnabledKey.set(false);
			return;
		}

		// Setting is enabled, now check if the Quarto extension is installed
		this._extensionService.getExtension(QUARTO_EXTENSION_ID).then(extension => {
			// Only enable if both the setting is enabled AND the extension is installed
			this._inlineOutputEnabledKey.set(extension !== undefined);
		});
	}

	private _updateIsQuartoDocument(): void {
		const isQuarto = this._isQuartoFile();
		this._isQuartoDocumentKey.set(isQuarto);
	}

	private _updateKernelRunning(): void {
		const uri = this._editorService.activeEditor?.resource;
		if (uri && this._isQuartoFile()) {
			const state = this._quartoKernelManager.getKernelState(uri);
			const isRunning = state === QuartoKernelState.Ready ||
				state === QuartoKernelState.Busy ||
				state === QuartoKernelState.Starting;
			this._kernelRunningKey.set(isRunning);
			this._kernelBusyKey.set(state === QuartoKernelState.Busy);
		} else {
			this._kernelRunningKey.set(false);
			this._kernelBusyKey.set(false);
		}
	}

	/**
	 * Auto-start the kernel for the active Quarto document, if it is pinned
	 * (i.e. not a preview tab). Sessions for backgrounded tabs are started
	 * when the user switches to them; sessions for preview tabs are started
	 * when the user pins them (typing, executing, double-clicking the tab,
	 * dragging the tab, etc.).
	 */
	private _autoStartKernelIfActiveAndPinned(): void {
		const activeEditor = this._editorService.activeEditor;
		if (!activeEditor) {
			return;
		}
		this._maybeAutoStartKernelForEditor(activeEditor);
	}

	private _maybeAutoStartKernelForEditor(editor: EditorInput): void {
		// Don't auto-start during startup/reconnection to avoid racing with
		// session restoration. The startup-phase listener re-runs this check
		// once startup completes.
		if (this._languageRuntimeService.startupPhase !== RuntimeStartupPhase.Complete) {
			return;
		}

		const uri = editor.resource;
		if (!uri || !isQuartoOrRmdFile(uri.path)) {
			return;
		}

		if (!this._inlineOutputEnabledKey.get()) {
			return;
		}

		// Find the editor's group and verify it is the active editor of that
		// group AND pinned. We never auto-start for preview tabs or for tabs
		// that are open in a group but not currently active.
		let activeAndPinned = false;
		for (const group of this._editorGroupsService.groups) {
			if (group.activeEditor === editor && group.isPinned(editor)) {
				activeAndPinned = true;
				break;
			}
		}
		if (!activeAndPinned) {
			return;
		}

		const key = uri.toString();
		if (this._autoStartedDocuments.has(key)) {
			return;
		}

		// If a session already exists (e.g. reconnected during startup), mark
		// the document as auto-started so we don't try again later.
		if (this._quartoKernelManager.getKernelState(uri) !== QuartoKernelState.None) {
			this._autoStartedDocuments.add(key);
			return;
		}

		this._autoStartedDocuments.add(key);

		// Fire and forget - kernel startup is handled asynchronously.
		// Use silent mode to avoid warning toasts for documents with no
		// code cells (e.g. a blank new Quarto document).
		this._quartoKernelManager.ensureKernelForDocument(uri, undefined, { silent: true }).catch(() => {
			// Errors are handled internally by the kernel manager
		});
	}

	/**
	 * Check if the active editor is a Quarto document.
	 * Checks both file extension and language ID to support untitled documents.
	 */
	private _isQuartoFile(): boolean {
		const uri = this._editorService.activeEditor?.resource;
		const activeEditor = this._editorService.activeTextEditorControl;

		// Get language ID from the editor model if available
		let languageId: string | undefined;
		if (isCodeEditor(activeEditor)) {
			const model = activeEditor.getModel();
			languageId = model?.getLanguageId();
		}

		return isQuartoDocument(uri?.path, languageId);
	}
}

// Register the contribution
registerWorkbenchContribution2(
	QuartoInlineOutputContribution.ID,
	QuartoInlineOutputContribution,
	WorkbenchPhase.AfterRestored
);

// Register the kernel status badge widget in the editor action bar
PositronActionBarWidgetRegistry.registerWidget({
	id: 'positronQuarto.kernelStatus',
	menuId: MenuId.EditorActionsRight,
	order: 100, // Rightmost position (same as notebook kernel status)
	when: ContextKeyExpr.and(
		QUARTO_INLINE_OUTPUT_ENABLED,
		// Important: use the per-editor-group resourceLangId here, NOT the
		// global IS_QUARTO_DOCUMENT context key. Widget `when` clauses are
		// evaluated per editor pane, so global context keys leak visibility
		// into unrelated panes (e.g. a notebook open beside a Quarto doc
		// would show two kernel selectors). resourceLangId is set on each
		// editor group's scoped context key service, so it correctly scopes
		// the widget to only panes showing a Quarto file. Compare with the
		// notebook kernel widget, which uses `activeEditor` -- also per-group.
		ContextKeyExpr.or(
			...QUARTO_LANGUAGE_IDS.map(id => ContextKeyExpr.equals(ResourceContextKey.LangId.key, id))
		)
	),
	selfContained: true,
	componentFactory: (accessor) => {
		return () => React.createElement(QuartoKernelStatusBadge, { accessor });
	}
});
