/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplInput, ConsoleReplInputProps } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplInput';

/**
 * ConsoleReplItemInputProps interface.
 */
export interface ConsoleReplItemInputProps extends ConsoleReplInputProps {
	key: string;
}

/**
 * ConsoleReplItemInput class.
 */
export class ConsoleReplItemInput implements ConsoleReplItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param props A ConsoleReplItemInputProps the contains the console REPL item props.
	 */
	constructor(private readonly _props: ConsoleReplItemInputProps) {
	}

	//#endregion Constructor

	//#region ConsoleReplItem Overrides

	get element(): JSX.Element {
		return <ConsoleReplInput {...this._props} />;
	}

	//#endregion ConsoleReplItem Overrides
}
