/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplError, ConsoleReplErrorProps } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplError';

/**
 * ConsoleReplItemErrorProps interface.
 */
export interface ConsoleReplItemErrorProps extends ConsoleReplErrorProps {
	key: string;
}

/**
 * ConsoleReplItemError class.
 */
export class ConsoleReplItemError implements ConsoleReplItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param props A ConsoleReplItemErrorProps the contains the console REPL item props.
	 */
	constructor(private readonly _props: ConsoleReplItemErrorProps) {
	}

	//#endregion Constructor

	//#region ConsoleReplItem Overrides

	get element(): JSX.Element {
		return <ConsoleReplError {...this._props} />;
	}

	//#endregion ConsoleReplItem Overrides
}
