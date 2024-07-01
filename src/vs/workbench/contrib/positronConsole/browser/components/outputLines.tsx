/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';

import { ANSIOutputLine } from 'vs/base/common/ansiOutput';
import { OutputLines as OutputLinesOriginal } from 'vs/workbench/browser/positronAnsiRenderer/outputLines';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

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
		openerService={openerService}
		notificationService={notificationService}
	/>;
};
