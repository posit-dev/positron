/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useLayoutEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IErrorActionContext, IQuartoErroredCell } from '../../positronAssistant/common/errorAction.js';
import { useActiveErrorActionHandler } from '../../positronAssistant/browser/useActiveErrorActionHandler.js';
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
 * Quick fix buttons for Quarto inline output errors, hidden while no handler
 * can take errors.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	// Read here rather than in AssistantErrorQuickFix so that a handler
	// change re-renders this component and runs the layout effect below,
	// re-measuring the host view zone when the buttons appear or disappear.
	const handler = useActiveErrorActionHandler();
	const services = usePositronReactServicesContext();

	const { errorContent, documentUri, cell, onLayout } = props;

	// Notify the host after every commit (declared before the early return so it
	// runs whether or not the buttons render). Layout effects fire once the DOM
	// is in place, so the host measures the true height of the mounted buttons.
	useLayoutEffect(() => {
		onLayout?.();
	});

	const getErrorContext = (): IErrorActionContext => {
		// A chunk whose language isn't the document's runs in that language's
		// console, not the document's kernel (quartoExecutionManager's
		// _executeRangeViaConsole), so the kernel is the wrong session for it.
		// Send the kernel only when its language matches the chunk's. When the
		// chunk can't be resolved there is nothing to compare, so the kernel is
		// sent as the best guess.
		const session = services.get(IQuartoKernelManager).getSessionForDocument(documentUri);
		const sessionRanCell = !cell || session?.runtimeMetadata.languageId === cell.languageId;
		return {
			kind: 'quarto',
			error: errorContent,
			uri: documentUri,
			cell,
			sessionId: sessionRanCell ? session?.sessionId : undefined,
		};
	};

	if (!handler) {
		return null;
	}

	return (
		<AssistantErrorQuickFix
			handler={handler}
			getErrorContext={getErrorContext}
			groupAriaLabel={localize('positron.quarto.quickFixGroup', "Output quick fix actions")}
		/>
	);
};
