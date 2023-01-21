/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplStartupBanner, ConsoleReplStartupBannerProps } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplStartupBanner';

/**
 * ConsoleReplItemStartupBannerProps interface.
 */
export interface ConsoleReplItemStartupBannerProps extends ConsoleReplStartupBannerProps {
	key: string;
}

/**
 * ConsoleReplItemStartupBanner class.
 */
export class ConsoleReplItemStartupBanner implements ConsoleReplItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param props A ConsoleReplItemStartupBannerProps the contains the console REPL item props.
	 */
	constructor(private readonly _props: ConsoleReplItemStartupBannerProps) {
	}

	//#endregion Constructor

	//#region ConsoleReplItem Implementation

	get element(): JSX.Element {
		return <ConsoleReplStartupBanner {...this._props} />;
	}

	//#endregion ConsoleReplItem Implementation
}
