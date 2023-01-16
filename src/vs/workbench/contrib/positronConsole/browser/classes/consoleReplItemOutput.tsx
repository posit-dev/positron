/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplOutput, ConsoleReplOutputProps } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplOutput';

/**
 * ConsoleReplItemStartupBannerProps interface.
 */
export interface ConsoleReplItemOutputProps extends ConsoleReplOutputProps {
	key: string;
}

/**
 * ConsoleReplItem class.
 */
export class ConsoleReplItemOutput implements ConsoleReplItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param props A ConsoleReplOutputProps the contains the console REPL item props.
	 */
	constructor(private readonly _props: ConsoleReplItemOutputProps) {
	}

	//#endregion Constructor

	//#region ConsoleReplItem Overrides

	get element(): JSX.Element {
		return <ConsoleReplOutput {...this._props} />;
	}

	//#endregion ConsoleReplItem Overrides
}
