/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { OutputLines as OutputLinesOriginal } from '../../../../browser/positronAnsiRenderer/outputLines.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';

export interface OutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * A remap of the `OutputLines` component that gets the services from the console context. Done to
 * avoid having to prop-drill the services every place we use `OutputLines` in the console. (A lot
 * of places.)
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLines = (props: OutputLinesProps) => {
	// Get services from the context.
	const { openerService, notificationService } = usePositronConsoleContext();

	return <OutputLinesOriginal
		{...props}
		notificationService={notificationService}
		openerService={openerService}
	/>;
};
