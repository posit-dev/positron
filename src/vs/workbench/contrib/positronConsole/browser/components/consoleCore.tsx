/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleCore';
import * as React from 'react';
import { ConsoleRepl } from 'vs/workbench/contrib/positronConsole/browser/components/consoleRepl';
import { PositronConsoleProps } from 'vs/workbench/contrib/positronConsole/browser/positronConsole';
import { ConsoleActionBar } from 'vs/workbench/contrib/positronConsole/browser/components/actionBar';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// ConsoleCoreProps interface.
interface ConsoleCoreProps extends PositronConsoleProps {
	height: number;
}

/**
 * ConsoleCore component.
 * @param props A ConsoleCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleCore = (props: ConsoleCoreProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// If there are no console instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronConsoleContext.consoleReplInstances.length) {
		return null;
	}

	// Render.
	return (
		<div className='console-core'>
			<ConsoleActionBar {...props} />
			<div className='console-repls-container' style={{ height: props.height - 32 }}>
				{positronConsoleContext.consoleReplInstances.map(consoleReplInstance =>
					<ConsoleRepl
						key={consoleReplInstance.positronConsoleInstance.runtime.metadata.id}
						hidden={consoleReplInstance !== positronConsoleContext.currentConsoleReplInstance}
						consoleReplInstance={consoleReplInstance} />
				)}
			</div>
		</div>
	);
};
