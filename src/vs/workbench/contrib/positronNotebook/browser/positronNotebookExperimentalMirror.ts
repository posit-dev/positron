/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL_KEY } from '../common/positronNotebookConfig.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL } from './ContextKeysManager.js';

/**
 * Initializes the experimental context key from the current configuration
 * value and subscribes to configuration changes to keep them in sync.
 * Returns a disposable for the change subscription.
 */
export function mirrorExperimentalConfigToContextKey(
	contextKeyService: IContextKeyService,
	configurationService: IConfigurationService,
): IDisposable {
	const key = POSITRON_NOTEBOOK_EXPERIMENTAL.bindTo(contextKeyService);
	key.set(configurationService.getValue<boolean>(POSITRON_NOTEBOOK_EXPERIMENTAL_KEY) ?? false);
	return configurationService.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration(POSITRON_NOTEBOOK_EXPERIMENTAL_KEY)) {
			key.set(configurationService.getValue<boolean>(POSITRON_NOTEBOOK_EXPERIMENTAL_KEY) ?? false);
		}
	});
}
