/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronTopActionBar';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ActionBarCommandButton } from 'vs/platform/positronActionBar/browser/components/actionBarCommandButton';
import { NavigateBackwardsAction, NavigateForwardAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { TopActionBarNewMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarNewMenu';
import { TopActionBarOpenMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarOpenMenu';
import { TopActionBarWorkspaceMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarWorkspaceMenu';
import { TopActionBarCommandCenter } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarCommandCenter';
import { PositronTopActionBarContextProvider } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { TopActionBarRuntimesManager } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarRuntimesManager';

// Constants.
const kHorizontalPadding = 4;
const kCenterUIBreak = 470;
const kFulllCenterUIBreak = 700;

/**
 * IPositronTopActionBarContainer interface.
 */
export interface IPositronTopActionBarContainer {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * onWidthChanged event.
	 */
	readonly onWidthChanged: Event<number>;
}

/**
 * PositronTopActionBarServices interface. Defines the set of services that are required by the Positron top action bar.
 */
export interface PositronTopActionBarServices extends PositronActionBarServices {
	hostService: IHostService;
	labelService: ILabelService;
	layoutService: ILayoutService;
	quickInputService: IQuickInputService;
	workspaceContextService: IWorkspaceContextService;
	workspacesService: IWorkspacesService;
	languageRuntimeService: ILanguageRuntimeService;
}

/**
 * PositronTopActionBarProps interface.
 */
interface PositronTopActionBarProps extends PositronTopActionBarServices {
	positronTopActionBarContainer: IPositronTopActionBarContainer;
}

/**
 * PositronTopActionBar component.
 * @param props A PositronTopActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronTopActionBar = (props: PositronTopActionBarProps) => {
	// State hooks.
	const [showCenterUI, setShowCenterUI] = useState(props.positronTopActionBarContainer.width > kCenterUIBreak);
	const [showFullCenterUI, setShowFullCenterUI] = useState(props.positronTopActionBarContainer.width > kFulllCenterUIBreak);
	const [runtimeRunning, setRuntimeRunning] = useState(props.languageRuntimeService.runningRuntimes.length > 0);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the width changed event handler.
		disposableStore.add(props.positronTopActionBarContainer.onWidthChanged(width => {
			setShowCenterUI(width > kCenterUIBreak);
			setShowFullCenterUI(width > kFulllCenterUIBreak);
		}));

		// Add the width changed event handler.
		disposableStore.add(props.languageRuntimeService.onDidChangeRunningRuntimes(() => {
			setRuntimeRunning(props.languageRuntimeService.runningRuntimes.length > 0);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// TODO@softwarenerd - This needs product management.
	let rumtimesManager;
	if (runtimeRunning) {
		rumtimesManager = <TopActionBarRuntimesManager />;
	} else {
		rumtimesManager = (
			<ActionBarButton
				align='right'
				border={true}
				text={localize('positronStartInterpreter', "Start Interpreter")}
				onClick={() => props.commandService.executeCommand('workbench.action.languageRuntime.start')}
			/>
		);
	}

	// Render.
	return (
		<PositronTopActionBarContextProvider {...props}>
			<PositronActionBarContextProvider {...props}>

				<PositronActionBar size='large' borderBottom={true} paddingLeft={kHorizontalPadding} paddingRight={kHorizontalPadding}>

					<ActionBarRegion location='left'>
						<TopActionBarNewMenu />
						<ActionBarSeparator />
						<TopActionBarOpenMenu />
						<ActionBarSeparator />
						<ActionBarCommandButton iconId='positron-save' commandId={'workbench.action.files.save'} />
						<ActionBarCommandButton iconId='positron-save-all' commandId={'workbench.action.files.saveFiles'} />
					</ActionBarRegion>

					{showCenterUI && (
						<ActionBarRegion location='center'>

							<PositronActionBar size='large'>
								{showFullCenterUI && (
									<ActionBarRegion width={80} location='left' justify='right'>
										<ActionBarCommandButton iconId='positron-chevron-left' commandId={NavigateBackwardsAction.ID} />
										<ActionBarCommandButton iconId='positron-chevron-right' commandId={NavigateForwardAction.ID} />
									</ActionBarRegion>
								)}
								<ActionBarRegion location='center'>
									<TopActionBarCommandCenter />
								</ActionBarRegion>
								{showFullCenterUI && (
									<ActionBarRegion width={80} location='right' justify='left'>
									</ActionBarRegion>
								)}
							</PositronActionBar>

						</ActionBarRegion>

					)}

					<ActionBarRegion location='right'>
						{rumtimesManager}
						<TopActionBarWorkspaceMenu />
					</ActionBarRegion>

				</PositronActionBar>
			</PositronActionBarContextProvider>
		</PositronTopActionBarContextProvider>
	);
};
