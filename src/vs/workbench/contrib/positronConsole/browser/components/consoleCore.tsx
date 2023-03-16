/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleCore';
import * as React from 'react';
import { ActionBar } from 'vs/workbench/contrib/positronConsole/browser/components/actionBar';
import { PositronConsoleProps } from 'vs/workbench/contrib/positronConsole/browser/positronConsole';
import { ConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstance';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// ConsoleCoreProps interface.
interface ConsoleCoreProps extends PositronConsoleProps {
	width: number;
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
	if (!positronConsoleContext.positronConsoleInstances.length) {
		return null;
	}

	// Render.
	return (
		<div className='console-core'>
			<ActionBar {...props} />
			<div className='console-instances-container' style={{ width: props.width, height: props.height - 32 }}>
				{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
					<ConsoleInstance
						width={props.width}
						height={props.height - 32}
						key={positronConsoleInstance.runtime.metadata.languageId}
						hidden={positronConsoleInstance !== positronConsoleContext.activePositronConsoleInstance}
						positronConsoleInstance={positronConsoleInstance} />
				)}
			</div>
		</div>
	);
};
