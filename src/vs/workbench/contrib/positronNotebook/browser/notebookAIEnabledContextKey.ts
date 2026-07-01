/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { bindContextKey, observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { NOTEBOOK_AI_ENABLED_KEY } from '../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Derive the {@link NotebookContextKeys.aiEnabled} context key from the two AI
 * switches and keep it in sync. This is the single place the composite gate is
 * computed: notebook AI is on only when the global `ai.enabled` is on AND the
 * notebooks-only `notebook.ai.enabled` is on. Both default to true, so an unset
 * value reads as enabled and only an explicit `false` disables.
 *
 * Every notebook AI feature reads the resulting context key rather than the two
 * settings, so the cascade can't drift between call sites.
 *
 * @returns a disposable that stops syncing the context key.
 */
export function bindNotebookAIEnabledContextKey(
	contextKeyService: IContextKeyService,
	configurationService: IConfigurationService,
): IDisposable {
	const aiEnabled = observableConfigValue<boolean>(AI_ENABLED_KEY, true, configurationService);
	const notebookAiEnabled = observableConfigValue<boolean>(NOTEBOOK_AI_ENABLED_KEY, true, configurationService);
	return bindContextKey(
		NotebookContextKeys.aiEnabled,
		contextKeyService,
		reader => aiEnabled.read(reader) === true && notebookAiEnabled.read(reader) !== false,
	);
}
