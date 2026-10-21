/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useLayoutEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IErrorAssistantContext, IQuartoErroredCell } from '../../positronAssistant/common/errorAssistant.js';
import { useActiveErrorAssistant } from '../../positronAssistant/browser/useActiveErrorAssistant.js';
import { AssistantErrorQuickFix } from '../../positronNotebook/browser/notebookCells/AssistantErrorQuickFix.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { URI } from '../../../../base/common/uri.js';

interface QuartoOutputQuickFixProps {
	/** The error output content from the Quarto cell execution. */
	errorContent: string;
	/** The Quarto document the error was raised in. */
	documentUri: URI;
	/** The cell that raised the error, as it was when the output arrived. */
	cell?: IQuartoErroredCell;
	/**
	 * Called after each render commits to the DOM. The buttons mount
	 * asynchronously, so the host view zone uses this to re-measure its height
	 * once they exist rather than relying on a ResizeObserver to notice the
	 * growth (which it can miss on a re-run; see posit-dev/positron#14844).
	 */
	onLayout?: () => void;
}

/**
 * Quick fix buttons for Quarto inline output errors, hidden while no assistant
 * can take errors.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	// Read here rather than in AssistantErrorQuickFix so that an assistant
	// change re-renders this component and runs the layout effect below,
	// re-measuring the host view zone when the buttons appear or disappear.
	const assistant = useActiveErrorAssistant();
	const services = usePositronReactServicesContext();

	const { errorContent, documentUri, cell, onLayout } = props;

	// Notify the host after every commit (declared before the early return so it
	// runs whether or not the buttons render). Layout effects fire once the DOM
	// is in place, so the host measures the true height of the mounted buttons.
	useLayoutEffect(() => {
		onLayout?.();
	});

	const getErrorContext = (): IErrorAssistantContext => ({
		kind: 'quarto',
		error: errorContent,
		uri: documentUri,
		cell,
		sessionId: services.get(IQuartoKernelManager).getSessionForDocument(documentUri)?.sessionId,
	});

	if (!assistant) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			assistant={assistant}
			getErrorContext={getErrorContext}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
