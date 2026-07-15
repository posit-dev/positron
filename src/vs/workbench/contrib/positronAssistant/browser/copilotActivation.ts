/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ChatConfiguration } from '../../chat/common/constants.js';

/**
 * Custom activation event fired when Positron's AI features are enabled.
 *
 * The bundled Copilot extension is heavyweight, so it declares this as an
 * activation event instead of `onStartupFinished`. That keeps it unloaded (and
 * off the memory budget) for users who have turned AI off, and activates it
 * eagerly for everyone else.
 */
export const COPILOT_ACTIVATION_EVENT = 'onCopilotEnabled';

/**
 * Fires {@link COPILOT_ACTIVATION_EVENT} while AI features are enabled -- that
 * is, whenever `chat.disableAIFeatures` is not `true` -- both at startup and
 * when the user changes the setting at runtime.
 *
 * VS Code cannot unload an already-activated extension without a reload, so
 * turning AI features off at runtime does not deactivate Copilot here; its
 * individual features are each gated on their own preconditions and go quiet on
 * their own.
 */
export class CopilotActivationContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		super();

		this._update();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.AIDisabled)) {
				this._update();
			}
		}));
	}

	private _update(): void {
		// `chat.disableAIFeatures` is inverted: `true` means AI is off. Activate
		// Copilot for every other value (including the unset default).
		if (this._configurationService.getValue<boolean>(ChatConfiguration.AIDisabled) !== true) {
			this._extensionService.activateByEvent(COPILOT_ACTIVATION_EVENT);
		}
	}
}
