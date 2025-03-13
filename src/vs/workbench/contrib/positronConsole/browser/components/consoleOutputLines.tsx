/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { OutputLines } from '../../../../browser/positronAnsiRenderer/outputLines.js';

// ConsoleOutputLinesProps interface.
export interface ConsoleOutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * A remap of the `OutputLines` component that gets the services from the console context. Done to
 * avoid having to prop-drill the services every place we use `OutputLines` in the console. (A lot
 * of places.)
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleOutputLines = (props: ConsoleOutputLinesProps) => {
	// Get services from the context.
	const { openerService, notificationService } = usePositronConsoleContext();

	// Render.
	return (
		<OutputLines
			{...props}
			notificationService={notificationService}
			openerService={openerService}
		/>
	);
};
