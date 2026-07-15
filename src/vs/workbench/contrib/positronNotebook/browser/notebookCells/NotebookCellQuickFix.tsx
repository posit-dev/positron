/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronConfiguration, useContextKey, useContextKeyFromString } from '../../../../../base/browser/positronReactHooks.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../../positronAssistant/browser/positAssistantChat.js';
import { AssistantErrorQuickFix } from './AssistantErrorQuickFix.js';

const fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
const explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");

const ATTACHMENT_NAME = 'notebook-cell-error.txt';

/**
 * Props for the NotebookCellQuickFix component.
 */
interface NotebookCellQuickFixProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Quick fix buttons for notebook cell errors. Gates on the notebook's AI
 * switches and, when enabled, delegates the buttons and assistant wiring to
 * {@link AssistantErrorQuickFix}.
 */
export const NotebookCellQuickFix = (props: NotebookCellQuickFixProps) => {
	const { errorContent } = props;

	// Configuration hooks to conditionally show the quick-fix buttons.
	// notebookAiEnabled is the composite gate (global ai.enabled AND
	// notebook.ai.enabled), kept in sync by bindNotebookAIEnabledContextKey.
	// undefined (before the key is bound) reads as enabled, matching the
	// settings' default of true.
	const notebookAiEnabled = useContextKey<boolean>(NotebookContextKeys.aiEnabled);
	const enableNotebookMode = usePositronConfiguration<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
	// Set by the Posit Assistant extension when it has at least one usable model.
	const hasChatModels = useContextKeyFromString<boolean>(POSIT_HAS_CHAT_MODELS_KEY);

	// Stable identity so AssistantErrorQuickFix's click handler and dropdown
	// actions aren't recreated on every render.
	const getPayload = useCallback(
		() => ({ fixPrompt, explainPrompt, attachmentContent: errorContent }),
		[errorContent]
	);

	// Only show buttons if notebook AI is enabled, notebook mode is enabled, and
	// chat models are available
	const showQuickFix = notebookAiEnabled !== false && enableNotebookMode && hasChatModels;

	// Don't render if assistant features are not enabled
	if (!showQuickFix) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			attachmentName={ATTACHMENT_NAME}
			getPayload={getPayload}
			groupAriaLabel={localize('positron.notebook.quickFixGroup', "Cell output quick fix actions")}
		/>
	);
};
