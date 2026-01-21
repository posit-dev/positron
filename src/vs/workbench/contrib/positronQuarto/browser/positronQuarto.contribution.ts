/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerEditorContribution, EditorContributionInstantiation } from '../../../../editor/browser/editorExtensions.js';
import { QuartoDocumentModelService, IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoKernelManager, IQuartoKernelManager } from './quartoKernelManager.js';
import { QuartoExecutionManager, IQuartoExecutionManager } from './quartoExecutionManager.js';
import { QuartoOutputManagerService, QuartoOutputContribution, IQuartoOutputManager } from './quartoOutputManager.js';
import { QuartoOutputCacheService } from './quartoOutputCacheService.js';
import { IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { QuartoStatusBarIndicator } from './quartoStatusBarIndicator.js';
import { QuartoExecutionDecorations } from './quartoExecutionDecorations.js';
import { QuartoMultiLanguageWarning } from './quartoMultiLanguageWarning.js';
import { QuartoCellToolbarController } from './quartoCellToolbarController.js';
import {
	IS_QUARTO_DOCUMENT,
	POSITRON_QUARTO_INLINE_OUTPUT_KEY,
	QUARTO_INLINE_OUTPUT_ENABLED,
} from '../common/positronQuartoConfig.js';

// Import the configuration to ensure it's registered
import '../common/positronQuartoConfig.js';

// Import commands to ensure they're registered
import './quartoCommands.js';

// Import CSS styles
import './media/quartoExecutionDecorations.css';
import './media/quartoOutputViewZone.css';
import './media/quartoToolbar.css';

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

/**
 * Contribution that manages Quarto inline output functionality.
 * Responsible for:
 * - Tracking context keys for Quarto documents
 * - Updating context keys when editor or configuration changes
 * - Managing the status bar indicator
 */
class QuartoInlineOutputContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoInlineOutput';

	private readonly _isQuartoDocumentKey = IS_QUARTO_DOCUMENT.bindTo(this._contextKeyService);
	private readonly _inlineOutputEnabledKey = QUARTO_INLINE_OUTPUT_ENABLED.bindTo(this._contextKeyService);

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// Initialize context keys
		this._updateInlineOutputEnabled();
		this._updateIsQuartoDocument();

		// Create the status bar indicator
		this._register(instantiationService.createInstance(QuartoStatusBarIndicator));

		// Listen for configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._updateInlineOutputEnabled();
			}
		}));

		// Listen for active editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._updateIsQuartoDocument();
		}));
	}

	private _updateInlineOutputEnabled(): void {
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		this._inlineOutputEnabledKey.set(enabled);
	}

	private _updateIsQuartoDocument(): void {
		const isQuarto = this._isQuartoFile(this._editorService.activeEditor?.resource?.path);
		this._isQuartoDocumentKey.set(isQuarto);
	}

	private _isQuartoFile(path: string | undefined): boolean {
		if (!path) {
			return false;
		}
		return path.endsWith('.qmd');
	}
}

// Register the contribution
registerWorkbenchContribution2(
	QuartoInlineOutputContribution.ID,
	QuartoInlineOutputContribution,
	WorkbenchPhase.AfterRestored
);
