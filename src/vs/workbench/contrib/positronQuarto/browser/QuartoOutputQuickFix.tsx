/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useLayoutEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { IErrorAssistantContext } from '../../positronAssistant/common/errorAssistant.js';
import { useActiveErrorAssistant } from '../../positronAssistant/browser/useActiveErrorAssistant.js';
import { AssistantErrorQuickFix } from '../../positronNotebook/browser/notebookCells/AssistantErrorQuickFix.js';
import { QuartoCellErrorContext } from '../common/quartoExecutionTypes.js';

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
 * Quick fix buttons for Quarto inline output errors, hidden while no assistant
 * can take errors.
 */
export const QuartoOutputQuickFix = (props: QuartoOutputQuickFixProps) => {
	// Read here rather than in AssistantErrorQuickFix so that an assistant
	// change re-renders this component and runs the layout effect below,
	// re-measuring the host view zone when the buttons appear or disappear.
	const assistant = useActiveErrorAssistant();

	const { errorContent, cellContext, onLayout } = props;

	// Notify the host after every commit (declared before the early return so it
	// runs whether or not the buttons render). Layout effects fire once the DOM
	// is in place, so the host measures the true height of the mounted buttons.
	useLayoutEffect(() => {
		onLayout?.();
	});

	const getErrorContext = useCallback((): IErrorAssistantContext => ({
		kind: 'quarto',
		error: removeAnsiEscapeCodes(errorContent),
		cell: cellContext && {
			uri: cellContext.uri,
			languageId: cellContext.language,
			label: cellContext.label,
			code: cellContext.code,
			startLine: cellContext.codeStartLine,
			endLine: cellContext.codeEndLine,
		},
	}), [cellContext, errorContent]);

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
