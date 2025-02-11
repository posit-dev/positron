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
import { RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ConsoleTabList } from './consoleTabList.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';

const MINIMUM_CONSOLE_TAB_LIST_WIDTH = 45;

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

	// State hooks.
	const [consolePaneWidth, setConsolePaneWidth] = useState(Math.trunc(2 * props.width / 3));
	const [consoleTabListWidth, setConsoleTabListWidth] = useState(Math.trunc(props.width / 3));
	const [startupPhase, setStartupPhase] = useState(
		positronConsoleContext.languageRuntimeService.startupPhase);

	// Main useEffect hook.
	useEffect(() => {
		const disposables =
			positronConsoleContext.languageRuntimeService.onDidChangeRuntimeStartupPhase(
				e => {
					setStartupPhase(e);
				});
		return () => disposables.dispose();
	});

	/**
	 * onBeginResize handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const handleBeginResize = (): VerticalSplitterResizeParams => ({
		minimumWidth: Math.trunc(3 * props.width / 5),
		maximumWidth: props.width - MINIMUM_CONSOLE_TAB_LIST_WIDTH,
		startingWidth: consolePaneWidth,
	});

	/**
	 * onResize event handler.
	 * @param newConsolePaneWidth The new console pane width.
	 */
	const handleResize = (newConsolePaneWidth: number) => {
		// Adjust the column widths.
		setConsolePaneWidth(newConsolePaneWidth);
		setConsoleTabListWidth(props.width - newConsolePaneWidth);
	};

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
			<div
				style={{ height: props.height, width: consolePaneWidth }}
			>
				<ActionBar {...props} />
				<div className='console-instances-container'>
					{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
						<ConsoleInstance
							key={positronConsoleInstance.session.runtimeMetadata.languageId}
							active={positronConsoleInstance === positronConsoleContext.activePositronConsoleInstance}
							height={adjustedHeight}
							positronConsoleInstance={positronConsoleInstance}
							reactComponentContainer={props.reactComponentContainer}
							width={consolePaneWidth}
						/>
					)}
				</div>
			</div>
			<VerticalSplitter
				configurationService={positronConsoleContext.configurationService}
				onBeginResize={handleBeginResize}
				onResize={handleResize}
			/>
			<ConsoleTabList height={props.height} width={consoleTabListWidth} />
		</div>
	);
};
