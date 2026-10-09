/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronConfiguration, useContextKey } from '../../../../../base/browser/positronReactHooks.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { IErrorLocation } from '../../../positronAssistant/common/errorActions.js';
import { useErrorActionHandler } from '../../../positronAssistant/browser/useErrorActionHandler.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { ErrorActionButtons } from './ErrorActionButtons.js';
import { useOptionalCell } from './CellProvider.js';

/**
 * Props for the NotebookCellErrorActions component.
 */
interface NotebookCellErrorActionsProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Fix and Explain buttons for notebook cell errors that send them to the
 * selected error action handler. Gates on the notebook's AI switches and
 * there being a handler, then delegates the buttons to
 * {@link ErrorActionButtons}. Replaces `NotebookCellQuickFix` while
 * `ai.errorActions.agents.enabled` is on.
 */
export const NotebookCellErrorActions = (props: NotebookCellErrorActionsProps) => {
	const { errorContent } = props;

	// Configuration hooks to conditionally show the quick-fix buttons.
	// notebookAiEnabled is the composite gate (global ai.enabled AND
	// notebook.ai.enabled), kept in sync by bindNotebookAIEnabledContextKey.
	// undefined (before the key is bound) reads as enabled, matching the
	// settings' default of true.
	const notebookAiEnabled = useContextKey<boolean>(NotebookContextKeys.aiEnabled);
	const enableNotebookMode = usePositronConfiguration<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
	const configuredHandler = useErrorActionHandler();

	const instance = useNotebookInstance();
	const cell = useOptionalCell();

	// Stable identity so ErrorActionButtons's click handler and dropdown
	// actions aren't recreated on every render. Resolved at click time so the
	// cell index and code reflect any cells added, moved, or edited since the
	// error.
	const getLocation = useCallback((): IErrorLocation => {
		const sessionId = instance.runtimeSession.get()?.sessionId;

		// The cell's index is -1 once it is removed from the notebook.
		if (!cell || cell.index < 0) {
			return { kind: 'notebook', uri: instance.uri, sessionId };
		}
		return { kind: 'notebook', uri: instance.uri, cellIndex: cell.index, code: cell.getContent(), languageId: cell.model.language, sessionId };
	}, [cell, instance]);

	// Only show buttons if notebook AI is enabled, notebook mode is enabled, and
	// there is somewhere to send the error
	if (notebookAiEnabled === false || !enableNotebookMode || !configuredHandler) {
		return null;
	}

	return (
		<ErrorActionButtons
			canContinueChat={configuredHandler.canContinueChat}
			errorActionHandler={configuredHandler.handler}
			errorOutput={errorContent}
			getLocation={getLocation}
			groupAriaLabel={localize('positron.notebook.quickFixGroup', "Cell output quick fix actions")}
		/>
	);
};
