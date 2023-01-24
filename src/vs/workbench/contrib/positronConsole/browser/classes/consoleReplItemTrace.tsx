/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplTrace, ConsoleReplTraceProps } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplTrace';

/**
 * ConsoleReplItemTraceProps interface.
 */
export interface ConsoleReplItemTraceProps extends ConsoleReplTraceProps {
	key: string;
}

/**
 * ConsoleReplItemTrace class.
 */
export class ConsoleReplItemTrace implements ConsoleReplItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param _props A ConsoleReplItemTraceProps the contains the console REPL item props.
	 */
	constructor(private readonly _props: ConsoleReplItemTraceProps) {
	}

	//#endregion Constructor

	//#region ConsoleReplItem Implementation

	get element(): JSX.Element {
		return <ConsoleReplTrace {...this._props} />;
	}

	//#endregion ConsoleReplItem Implementation
}
