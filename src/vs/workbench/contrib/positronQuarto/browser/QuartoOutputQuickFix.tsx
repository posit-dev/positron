/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { usePositronConfiguration, useContextKeyFromString } from '../../../../base/browser/positronReactHooks.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../positronAssistant/browser/positAssistantChat.js';
import { AssistantErrorQuickFix, AssistantErrorPayload } from '../../positronNotebook/browser/notebookCells/AssistantErrorQuickFix.js';
import { QuartoCellErrorContext } from '../common/quartoExecutionTypes.js';

const fixPrompt = localize('positronQuartoAssistantFixPrompt', "Fix this Quarto inline output error.");
const explainPrompt = localize('positronQuartoAssistantExplainPrompt', "Explain this Quarto inline output error.");

const ATTACHMENT_NAME = 'quarto-output-error.txt';

interface QuartoOutputQuickFixProps {
	/** The error output content from the Quarto cell execution. */
	errorContent: string;
	/** Cell context resolved at render time. */
	cellContext?: QuartoCellErrorContext;
}

/**
 * Quick fix buttons for Quarto inline output errors. Gated on ai.enabled +
 * posit-assistant.hasChatModels; renders nothing when either is off.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	const hasChatModels = useContextKeyFromString<boolean>(POSIT_HAS_CHAT_MODELS_KEY);

	const { errorContent, cellContext } = props;

	const buildPayload = useCallback((): AssistantErrorPayload => {
		if (!cellContext) {
			return { fixPrompt, explainPrompt, attachmentContent: errorContent };
		}
		const header = cellContext.label
			? localize('positronQuartoErrorContextHeaderLabeled', "Error from the {0} code chunk in {1}, lines {2}-{3} (label: {4}):", cellContext.language, cellContext.path, cellContext.codeStartLine, cellContext.codeEndLine, cellContext.label)
			: localize('positronQuartoErrorContextHeader', "Error from the {0} code chunk in {1}, lines {2}-{3}:", cellContext.language, cellContext.path, cellContext.codeStartLine, cellContext.codeEndLine);
		const codeHeader = localize('positronQuartoErrorContextCodeHeader', "--- Failing code ---");
		const errorHeader = localize('positronQuartoErrorContextErrorHeader', "--- Error output ---");
		return {
			fixPrompt: localize('positronQuartoAssistantFixPromptWithContext', "Fix the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached; fix only this error.", cellContext.language, cellContext.codeStartLine, cellContext.codeEndLine, cellContext.path),
			explainPrompt: localize('positronQuartoAssistantExplainPromptWithContext', "Explain the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached.", cellContext.language, cellContext.codeStartLine, cellContext.codeEndLine, cellContext.path),
			attachmentContent: `${header}\n\n${codeHeader}\n${cellContext.code}\n\n${errorHeader}\n${errorContent}`,
		};
	}, [cellContext, errorContent]);

	if (aiEnabled === false || !hasChatModels) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			attachmentName={ATTACHMENT_NAME}
			getPayload={buildPayload}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
