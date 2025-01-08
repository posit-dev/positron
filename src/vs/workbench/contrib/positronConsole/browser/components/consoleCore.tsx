/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleCore.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBar } from './actionBar.js';
import { EmptyConsole } from './emptyConsole.js';
import { ConsoleInstance } from './consoleInstance.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { StartupStatus } from './startupStatus.js';
import { RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService';

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

	const [startupPhase, setStartupPhase] = useState(
		positronConsoleContext.languageRuntimeService.startupPhase);

	useEffect(() => {
		const disposables =
			positronConsoleContext.languageRuntimeService.onDidChangeRuntimeStartupPhase(
				e => {
					setStartupPhase(e);
				});
		return () => disposables.dispose();
	});

	// If there are no console instances, render the empty console and return.
	if (positronConsoleContext.positronConsoleInstances.length === 0) {
		if (startupPhase === RuntimeStartupPhase.Complete) {
			return <EmptyConsole />;
		} else {
			return <StartupStatus />;
		}
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
						key={positronConsoleInstance.session.runtimeMetadata.languageId}
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
