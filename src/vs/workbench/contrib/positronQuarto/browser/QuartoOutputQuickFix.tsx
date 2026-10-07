/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useLayoutEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { usePositronConfiguration, useContextKeyFromString } from '../../../../base/browser/positronReactHooks.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../positronAssistant/browser/positAssistantChat.js';
import { AssistantErrorQuickFix, AssistantErrorPayload } from '../../positronNotebook/browser/notebookCells/AssistantErrorQuickFix.js';
import { useErrorActionHandler } from '../../positronAssistant/browser/useErrorActionHandler.js';
import { QuartoCellErrorContext } from '../common/quartoExecutionTypes.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

const fixPrompt = localize('positronQuartoAssistantFixPrompt', "Fix this Quarto inline output error.");
const explainPrompt = localize('positronQuartoAssistantExplainPrompt', "Explain this Quarto inline output error.");

const ATTACHMENT_NAME = localize('positronQuartoAssistantErrorAttachmentName', "Quarto Output Error");

interface QuartoOutputQuickFixProps {
	/** The error output content from the Quarto cell execution. */
	errorContent: string;
	/** Cell context resolved at render time. */
	cellContext?: QuartoCellErrorContext;
	/**
	 * Called after each render commits to the DOM. The buttons mount
	 * asynchronously, so the host view zone uses this to re-measure its height
	 * once they exist rather than relying on a ResizeObserver to notice the
	 * growth (which it can miss on a re-run; see posit-dev/positron#14844).
	 */
	onLayout?: () => void;
}

/**
 * Quick fix buttons for Quarto inline output errors. Gated on ai.enabled and
 * either a registered error action handler or posit-assistant.hasChatModels.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	const hasChatModels = useContextKeyFromString<boolean>(POSIT_HAS_CHAT_MODELS_KEY);
	const errorActionHandler = useErrorActionHandler();

	const { errorContent, cellContext, onLayout } = props;
	const quartoKernelManager = usePositronReactServicesContext().get(IQuartoKernelManager);

	// Notify the host after every commit (declared before the early return so it
	// runs whether or not the buttons render). Layout effects fire once the DOM
	// is in place, so the host measures the true height of the mounted buttons.
	useLayoutEffect(() => {
		onLayout?.();
	});

	const buildPayload = useCallback((): AssistantErrorPayload => {
		if (!cellContext) {
			return { fixPrompt, explainPrompt, attachmentContent: errorContent, errorOutput: errorContent };
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
			errorOutput: errorContent,
			errorLocation: {
				kind: 'quarto',
				uri: cellContext.uri,
				languageId: cellContext.language,
				startLine: cellContext.codeStartLine,
				endLine: cellContext.codeEndLine,
				code: cellContext.code,
				sessionId: quartoKernelManager.getSessionForDocument(cellContext.uri)?.sessionId,
			},
		};
	}, [cellContext, errorContent, quartoKernelManager]);

	if (aiEnabled === false || (errorActionHandler === undefined && !hasChatModels)) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			attachmentName={ATTACHMENT_NAME}
			errorActionHandler={errorActionHandler}
			getPayload={buildPayload}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
