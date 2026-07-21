/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInputSubmitting.css';

/**
 * ConsoleInputSubmittingProps interface.
 */
interface ConsoleInputSubmittingProps {
	/** Whether the barber pole should be shown. */
	readonly visible: boolean;
}

/**
 * ConsoleInputSubmitting component. Renders a green barber pole over the console
 * input's gutter while a code submission is being prepared for execution. The
 * parent owns the debounce timer and passes `visible`.
 *
 * @param props A ConsoleInputSubmittingProps that contains the component props.
 * @returns The rendered component.
 */
export const ConsoleInputSubmitting = (props: ConsoleInputSubmittingProps) => {
	if (!props.visible) {
		return null;
	}
	return <div className='console-input-submitting-bar' />;
};
