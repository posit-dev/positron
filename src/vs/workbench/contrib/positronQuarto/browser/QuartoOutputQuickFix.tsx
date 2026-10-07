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
import { AssistantErrorQuickFix } from '../../positronNotebook/browser/notebookCells/AssistantErrorQuickFix.js';
import { useErrorActionHandler } from '../../positronAssistant/browser/useErrorActionHandler.js';
import { QuartoCellErrorContext } from '../common/quartoExecutionTypes.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

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
 * there being an error action handler to send the error to.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	const errorActionHandler = useErrorActionHandler();

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

	if (aiEnabled === false || !errorActionHandler) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			errorActionHandler={errorActionHandler}
			errorOutput={errorContent}
			getLocation={getLocation}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
