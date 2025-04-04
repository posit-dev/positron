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
import { multipleConsoleSessionsFeatureEnabled } from '../../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

// Constants.
const ACTION_BAR_HEIGHT = 32;
const MINIMUM_CONSOLE_TAB_LIST_WIDTH = 64;
const MINIMUM_CONSOLE_PANE_WIDTH = 120;

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
	// Calculate the adjusted height (the height minus the action bar height).
	const adjustedHeight = props.height - ACTION_BAR_HEIGHT;

	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(positronConsoleContext.configurationService);

	// State hooks.
	const [consoleWidth, setConsoleWidth] = useState(0);
	const [consolePaneWidth, setConsolePaneWidth] = useState(0);
	const [consoleTabListWidth, setConsoleTabListWidth] = useState(0);
	const [startupPhase, setStartupPhase] = useState(positronConsoleContext.languageRuntimeService.startupPhase);

	// Main useEffect hook.
	useEffect(() => {
		const disposables = positronConsoleContext.languageRuntimeService.onDidChangeRuntimeStartupPhase(e => {
			setStartupPhase(e);
		});
		return () => disposables.dispose();
	}, [positronConsoleContext.languageRuntimeService]);

	// Console Width Effect
	useEffect(() => {
		// The maximum tab list width is 1/5 of the total available width
		const MAXIMUM_CONSOLE_TAB_LIST_WIDTH = Math.trunc(props.width / 5);

		if (positronConsoleContext.consoleSessionListCollapsed) {
			setConsolePaneWidth(props.width);
			return;
		}

		// Initialize the width for the console pane and console tab list if it hasn't been
		if (consoleWidth === 0) {
			setConsoleTabListWidth(MAXIMUM_CONSOLE_TAB_LIST_WIDTH)
			// Allocate the remaining width to the console pane
			setConsolePaneWidth(props.width - MAXIMUM_CONSOLE_TAB_LIST_WIDTH);
		} else if (props.width >= consoleWidth) {
			// Allocate any additional width to the console pane when parent width is increased
			setConsolePaneWidth(props.width - consoleTabListWidth);
		} else if (props.width < consoleWidth) {
			const newConsolePaneWidth = props.width - consoleTabListWidth;
			// Decrease the console pane width first as long as we have not hit the minimum width
			if (newConsolePaneWidth >= MINIMUM_CONSOLE_PANE_WIDTH) {
				setConsolePaneWidth(newConsolePaneWidth)
			} else {
				// Decrease the tab list width when the console pane can no longer be decreased in width
				setConsoleTabListWidth(Math.max(props.width - consolePaneWidth, MINIMUM_CONSOLE_TAB_LIST_WIDTH));
			}
		}

		// Track the console width to accurately resize in future
		setConsoleWidth(props.width)
	}, [consolePaneWidth, consoleTabListWidth, consoleWidth, props.width, positronConsoleContext.consoleSessionListCollapsed])

	/**
	 * onBeginResize handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const handleBeginResize = (): VerticalSplitterResizeParams => ({
		minimumWidth: MINIMUM_CONSOLE_PANE_WIDTH,
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

	// Render.
	return (
		<div className={positronClassNames('console-core', { 'console-tab-list': multiSessionsEnabled })}>
			{multiSessionsEnabled &&
				<>
					<div style={{ height: props.height, width: consolePaneWidth }}>
						<ActionBar {...props} showDeleteButton={positronConsoleContext.consoleSessionListCollapsed} />
						{/* #6845 - Only render console instances when the console pane width is greater than 0. */}
						{consolePaneWidth > 0 &&
							<div className='console-instances-container'>
								{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
									<ConsoleInstance
										key={positronConsoleInstance.sessionId}
										active={positronConsoleInstance.sessionId === positronConsoleContext.activePositronConsoleInstance?.sessionId}
										height={adjustedHeight}
										positronConsoleInstance={positronConsoleInstance}
										reactComponentContainer={props.reactComponentContainer}
										width={consolePaneWidth}
									/>
								)}
							</div>
						}
					</div>
					{consoleTabListWidth > 0 &&
						<VerticalSplitter
							configurationService={positronConsoleContext.configurationService}
							onBeginResize={handleBeginResize}
							onResize={handleResize}
						/>
					}
					{!positronConsoleContext.consoleSessionListCollapsed && consoleTabListWidth > 0 &&
						<ConsoleTabList height={props.height} width={consoleTabListWidth} />
					}
				</>
			}
			{!multiSessionsEnabled &&
				<>
					<ActionBar {...props} />
					<div className='console-instances-container' style={{ width: props.width, height: adjustedHeight }}>
						{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
							<ConsoleInstance
								key={positronConsoleInstance.runtimeMetadata.languageId}
								active={positronConsoleInstance === positronConsoleContext.activePositronConsoleInstance}
								height={adjustedHeight}
								positronConsoleInstance={positronConsoleInstance}
								reactComponentContainer={props.reactComponentContainer}
								width={props.width}
							/>
						)}
					</div>
				</>
			}
		</div>
	);
};
