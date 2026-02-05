/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { registerEditorContribution, EditorContributionInstantiation } from '../../../../editor/browser/editorExtensions.js';
import { QuartoDocumentModelService, IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoKernelManager, IQuartoKernelManager } from './quartoKernelManager.js';
import { QuartoExecutionManager, IQuartoExecutionManager } from './quartoExecutionManager.js';
import { QuartoOutputManagerService, QuartoOutputContribution, IQuartoOutputManager } from './quartoOutputManager.js';
import { QuartoOutputCacheService } from './quartoOutputCacheService.js';
import { IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { QuartoExecutionDecorations } from './quartoExecutionDecorations.js';
import { QuartoMultiLanguageWarning } from './quartoMultiLanguageWarning.js';
import { QuartoCellToolbarController } from './quartoCellToolbarController.js';
import { QuartoImagePreviewContribution } from './quartoImagePreview.js';
import {
	IS_QUARTO_DOCUMENT,
	POSITRON_QUARTO_INLINE_OUTPUT_KEY,
	QUARTO_INLINE_OUTPUT_ENABLED,
	QUARTO_KERNEL_RUNNING,
	isQuartoDocument,
} from '../common/positronQuartoConfig.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { QuartoKernelState } from './quartoKernelManager.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { QuartoKernelStatusBadge } from './QuartoKernelStatusBadge.js';

// Import the configuration to ensure it's registered
import '../common/positronQuartoConfig.js';

// Import commands to ensure they're registered
import './quartoCommands.js';

// Import CSS styles
import './media/quartoExecutionDecorations.css';
import './media/quartoOutputViewZone.css';
import './media/quartoToolbar.css';
import './media/quartoImagePreview.css';

// Register services
registerSingleton(IQuartoDocumentModelService, QuartoDocumentModelService, InstantiationType.Delayed);
registerSingleton(IQuartoKernelManager, QuartoKernelManager, InstantiationType.Delayed);
registerSingleton(IQuartoExecutionManager, QuartoExecutionManager, InstantiationType.Delayed);
registerSingleton(IQuartoOutputCacheService, QuartoOutputCacheService, InstantiationType.Delayed);
registerSingleton(IQuartoOutputManager, QuartoOutputManagerService, InstantiationType.Delayed);

// Register editor contributions
registerEditorContribution(QuartoExecutionDecorations.ID, QuartoExecutionDecorations, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoOutputContribution.ID, QuartoOutputContribution, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoMultiLanguageWarning.ID, QuartoMultiLanguageWarning, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoCellToolbarController.ID, QuartoCellToolbarController, EditorContributionInstantiation.AfterFirstRender);
registerEditorContribution(QuartoImagePreviewContribution.ID, QuartoImagePreviewContribution, EditorContributionInstantiation.AfterFirstRender);

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

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IQuartoKernelManager private readonly _quartoKernelManager: IQuartoKernelManager,
		@IExtensionService private readonly _extensionService: IExtensionService,
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
		}));

		// Listen for kernel state changes
		this._register(this._quartoKernelManager.onDidChangeKernelState(() => {
			this._updateKernelRunning();
		}));

		// Listen for extension changes (install/uninstall)
		this._register(this._extensionService.onDidChangeExtensions(() => {
			this._updateInlineOutputEnabled();
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
		} else {
			this._kernelRunningKey.set(false);
		}
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
		if (activeEditor && 'getModel' in activeEditor) {
			const model = (activeEditor as ICodeEditor).getModel();
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
		IS_QUARTO_DOCUMENT
	),
	selfContained: true,
	componentFactory: (accessor) => {
		return () => React.createElement(QuartoKernelStatusBadge, { accessor });
	}
});
