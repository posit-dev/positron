/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IErrorActionContext } from '../../../positronAssistant/common/errorAction.js';
import { useActiveErrorActionHandler } from '../../../positronAssistant/browser/useActiveErrorActionHandler.js';
import { usePositronConfiguration, useContextKey } from '../../../../../base/browser/positronReactHooks.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { AssistantErrorQuickFix } from './AssistantErrorQuickFix.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useCell } from './CellProvider.js';

/**
 * Props for the NotebookCellQuickFix component.
 */
interface NotebookCellQuickFixProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Quick fix buttons for notebook cell errors. Gates on the notebook's AI
 * switches and, when enabled, delegates the buttons and handler wiring to
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
	const handler = useActiveErrorActionHandler();
	const instance = useNotebookInstance();
	const cell = useCell();

	// Resolved on click, so the cell's index and code reflect any edits since
	// the error. A cell's index is -1 once it's removed from the notebook.
	const getErrorContext = (): IErrorActionContext => {
		const index = cell.index;
		return {
			kind: 'notebook',
			error: errorContent,
			uri: instance.uri,
			cell: index >= 0
				? { index, code: cell.getContent(), languageId: cell.model.language }
				: undefined,
			sessionId: instance.runtimeSession.get()?.sessionId,
		};
	};

	// Only show buttons if notebook AI is enabled, notebook mode is enabled, and
	// a handler can take errors.
	const showQuickFix = notebookAiEnabled !== false && enableNotebookMode;

	// Don't render if assistant features are not enabled
	if (!showQuickFix || !handler) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			handler={handler}
			getErrorContext={getErrorContext}
			groupAriaLabel={localize('positron.notebook.quickFixGroup', "Cell output quick fix actions")}
		/>
	);
};
