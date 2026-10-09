/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useLayoutEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { usePositronConfiguration } from '../../../../base/browser/positronReactHooks.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IErrorLocation } from '../../positronAssistant/common/errorActions.js';
import { ErrorActionButtons } from '../../positronNotebook/browser/notebookCells/ErrorActionButtons.js';
import { useErrorActionHandler } from '../../positronAssistant/browser/useErrorActionHandler.js';
import { QuartoCellErrorContext } from '../common/quartoExecutionTypes.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

export interface QuartoOutputErrorActionsProps {
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
 * Fix and Explain buttons for Quarto inline output errors that send them to
 * the selected error action handler. Gated on ai.enabled and there being a
 * handler. Replaces `QuartoOutputQuickFix` while
 * `ai.errorActions.agents.enabled` is on.
 */
export const QuartoOutputErrorActions = (props: QuartoOutputErrorActionsProps) => {
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	const configuredHandler = useErrorActionHandler();

	const { errorContent, cellContext, onLayout } = props;
	const quartoKernelManager = usePositronReactServicesContext().get(IQuartoKernelManager);

	// Notify the host after every commit (declared before the early return so it
	// runs whether or not the buttons render). Layout effects fire once the DOM
	// is in place, so the host measures the true height of the mounted buttons.
	useLayoutEffect(() => {
		onLayout?.();
	});

	const getLocation = useCallback((): IErrorLocation | undefined => {
		if (!cellContext) {
			return undefined;
		}
		return {
			kind: 'quarto',
			uri: cellContext.uri,
			languageId: cellContext.language,
			startLine: cellContext.codeStartLine,
			endLine: cellContext.codeEndLine,
			code: cellContext.code,
			label: cellContext.label,
			sessionId: quartoKernelManager.getSessionForDocument(cellContext.uri)?.sessionId,
		};
	}, [cellContext, quartoKernelManager]);

	if (aiEnabled === false || !configuredHandler) {
		return null;
	}

	return (
		<ErrorActionButtons
			canContinueChat={configuredHandler.canContinueChat}
			errorActionHandler={configuredHandler.handler}
			errorOutput={errorContent}
			getLocation={getLocation}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
