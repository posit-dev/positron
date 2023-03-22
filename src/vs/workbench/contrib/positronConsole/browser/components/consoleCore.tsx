/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBar } from 'vs/workbench/contrib/positronConsole/browser/components/actionBar';
import { ConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstance';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// ConsoleCoreProps interface.
interface ConsoleCoreProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
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
			<ActionBar />
			<div className='console-instances-container' style={{ width: props.width, height: props.height - 32 }}>
				{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
					<ConsoleInstance
						key={positronConsoleInstance.runtime.metadata.languageId}
						width={props.width}
						height={props.height - 32}
						positronConsoleInstance={positronConsoleInstance}
						focusReceiver={props.reactComponentContainer}
						hidden={positronConsoleInstance !== positronConsoleContext.activePositronConsoleInstance} />
				)}
			</div>
		</div>
	);
};
