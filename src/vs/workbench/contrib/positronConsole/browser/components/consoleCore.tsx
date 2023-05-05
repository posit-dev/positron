/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBar } from 'vs/workbench/contrib/positronConsole/browser/components/actionBar';
import { EmptyConsole } from 'vs/workbench/contrib/positronConsole/browser/components/emptyConsole';
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

	// If there are no console instances, render the empty console and return.
	if (!positronConsoleContext.positronConsoleInstances.length) {
		return <EmptyConsole />;
	}

	// Calculate the adjusted height (the height minus the action bar height).
	const adjustedHeight = props.height - 32;

	// Render.
	return (
		<div className='console-core'>
			<ActionBar {...props} />
			<div className='console-instances-container' style={{ width: props.width, height: adjustedHeight }}>
				{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
					<ConsoleInstance
						key={positronConsoleInstance.runtime.metadata.languageId}
						active={positronConsoleInstance === positronConsoleContext.activePositronConsoleInstance}
						width={props.width}
						height={adjustedHeight}
						positronConsoleInstance={positronConsoleInstance}
						reactComponentContainer={props.reactComponentContainer}
					/>
				)}
			</div>
		</div>
	);
};
