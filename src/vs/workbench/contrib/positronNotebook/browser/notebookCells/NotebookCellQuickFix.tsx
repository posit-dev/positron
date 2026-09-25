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
import { useErrorActionTarget } from '../../../positronAssistant/browser/useErrorActionTarget.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { AssistantErrorPayload, AssistantErrorQuickFix } from './AssistantErrorQuickFix.js';
import { useOptionalCell } from './CellProvider.js';

const fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
const explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");

const ATTACHMENT_NAME = localize('positronNotebookAssistantErrorAttachmentName', "Notebook Cell Error");

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
	// A contributed target (e.g. Claude Code) replaces the chat models check.
	const errorActionTarget = useErrorActionTarget();

	const { labelService } = usePositronReactServicesContext();
	const instance = useNotebookInstance();
	const cell = useOptionalCell();

	// Stable identity so AssistantErrorQuickFix's click handler and dropdown
	// actions aren't recreated on every render. Resolved at click time so the
	// cell number reflects any cells added or moved since the error.
	const getPayload = useCallback((): AssistantErrorPayload => {
		if (!cell) {
			return { fixPrompt, explainPrompt, attachmentContent: errorContent };
		}
		const cellNumber = cell.index + 1;
		const path = labelService.getUriLabel(instance.uri, { relative: true });
		const header = localize('positronNotebookErrorContextHeader', "Error from cell {0} of {1}:", cellNumber, path);
		const codeHeader = localize('positronNotebookErrorContextCodeHeader', "--- Failing code ---");
		const errorHeader = localize('positronNotebookErrorContextErrorHeader', "--- Error output ---");
		return {
			fixPrompt: localize('positronNotebookAssistantFixPromptWithContext', "Fix the error from cell {0} of {1}. The failing code and its error output are attached; fix only this error.", cellNumber, path),
			explainPrompt: localize('positronNotebookAssistantExplainPromptWithContext', "Explain the error from cell {0} of {1}. The failing code and its error output are attached.", cellNumber, path),
			attachmentContent: `${header}\n\n${codeHeader}\n${cell.getContent()}\n\n${errorHeader}\n${errorContent}`,
		};
	}, [cell, errorContent, instance, labelService]);

	// Only show buttons if notebook AI is enabled, notebook mode is enabled, and
	// there is somewhere to send the error
	const showQuickFix = notebookAiEnabled !== false && enableNotebookMode && (errorActionTarget !== undefined || hasChatModels);

	// Don't render if assistant features are not enabled
	if (!showQuickFix) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			attachmentName={ATTACHMENT_NAME}
			getPayload={getPayload}
			groupAriaLabel={localize('positron.notebook.quickFixGroup', "Cell output quick fix actions")}
			target={errorActionTarget}
		/>
	);
};
