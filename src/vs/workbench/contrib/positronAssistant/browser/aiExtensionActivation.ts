/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';

/**
 * Custom activation event fired while Positron's AI features are enabled, i.e.
 * while `ai.enabled` (the main AI switch) is `true`.
 *
 * Heavyweight AI extensions (e.g. the bundled `positron-assistant`) declare this
 * as an activation event instead of `onStartupFinished`, so they stay unloaded
 * (and off the memory budget) when AI is turned off, and activate eagerly when
 * it's on.
 */
export const AI_ENABLED_ACTIVATION_EVENT = 'onAiEnabled';

/**
 * Fires {@link AI_ENABLED_ACTIVATION_EVENT} while `ai.enabled` is `true`, both
 * at startup and when the user changes the setting at runtime.
 *
 * VS Code cannot unload an already-activated extension without a reload, so
 * turning the setting off at runtime does not deactivate anything here; the AI
 * extensions' individual features are each gated on their own preconditions and
 * go quiet on their own. See `.claude/rules/ai-gating.md`.
 */
export class AiExtensionActivationContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		super();

		this._update();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._update();
			}
		}));
	}

	private _update(): void {
		// `ai.enabled` defaults to `true`; activate only when it reads exactly
		// `true` (an unset value already reads through as the `true` default).
		if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true) {
			this._extensionService.activateByEvent(AI_ENABLED_ACTIVATION_EVENT);
		}
	}
}
