/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTopActionBar.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { CommandCenter } from '../../../../platform/commandCenter/common/commandCenter.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronActionBar } from '../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarRegion } from '../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarSeparator } from '../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { PositronActionBarServices } from '../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { ActionBarCommandButton } from '../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { NavigateBackwardsAction, NavigateForwardAction } from '../editor/editorActions.js';
import { PositronActionBarContextProvider } from '../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { TopActionBarNewMenu } from './components/topActionBarNewMenu.js';
import { TopActionBarOpenMenu } from './components/topActionBarOpenMenu.js';
import { IPositronTopActionBarService } from '../../../services/positronTopActionBar/browser/positronTopActionBarService.js';
import { TopActionBarCommandCenter } from './components/topActionBarCommandCenter.js';
import { PositronTopActionBarContextProvider } from './positronTopActionBarContext.js';
import { TopActionBarCustomFolderMenu } from './components/topActionBarCustomFolderMenu.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { TopActionBarSessionManager } from './components/topActionBarSessionManager.js';
import { SAVE_ALL_COMMAND_ID, SAVE_FILE_COMMAND_ID } from '../../../contrib/files/browser/fileConstants.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

// Constants.
const kHorizontalPadding = 4;
const kCenterUIBreak = 600;
const kFulllCenterUIBreak = 765;
const SAVE = SAVE_FILE_COMMAND_ID;
const SAVE_ALL = SAVE_ALL_COMMAND_ID;
const NAV_BACK = NavigateBackwardsAction.ID;
const NAV_FORWARD = NavigateForwardAction.ID;

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
 * PositronTopActionBarServices interface. Defines the set of services that are required by the
 * Positron top action bar.
 */
export interface PositronTopActionBarServices extends PositronActionBarServices {
	configurationService: IConfigurationService;
	hostService: IHostService;
	labelService: ILabelService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: ILayoutService;
	positronTopActionBarService: IPositronTopActionBarService;
	quickInputService: IQuickInputService;
	runtimeStartupService: IRuntimeStartupService;
	runtimeSessionService: IRuntimeSessionService;
	workspaceContextService: IWorkspaceContextService;
	workspacesService: IWorkspacesService;
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
	const [showCenterUI, setShowCenterUI] = useState(
		props.positronTopActionBarContainer.width > kCenterUIBreak
	);
	const [showFullCenterUI, setShowFullCenterUI] = useState(
		props.positronTopActionBarContainer.width > kFulllCenterUIBreak
	);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the width changed event handler.
		disposableStore.add(props.positronTopActionBarContainer.onWidthChanged(width => {
			setShowCenterUI(width > kCenterUIBreak);
			setShowFullCenterUI(width > kFulllCenterUIBreak);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.positronTopActionBarContainer]);

	// Render.
	return (
		<PositronTopActionBarContextProvider {...props}>
			<PositronActionBarContextProvider {...props}>
				<div className='top-action-bar-container'>
					<PositronActionBar
						borderBottom={false}
						paddingLeft={kHorizontalPadding}
						paddingRight={kHorizontalPadding}
					>
						<ActionBarRegion location='left'>
							<TopActionBarNewMenu />
							<ActionBarSeparator />
							<TopActionBarOpenMenu />
							<ActionBarSeparator />
							<ActionBarCommandButton
								ariaLabel={CommandCenter.title(SAVE)}
								commandId={SAVE}
								icon={ThemeIcon.fromId('positron-save')}
							/>
							<ActionBarCommandButton
								ariaLabel={CommandCenter.title(SAVE_ALL)}
								commandId={SAVE_ALL}
								icon={ThemeIcon.fromId('positron-save-all')}
							/>
						</ActionBarRegion>
						{showCenterUI && (
							<ActionBarRegion location='center'>
								<PositronActionBar nestedActionBar={true}>
									{showFullCenterUI && (
										<ActionBarRegion justify='right' location='left' width={60}>
											<ActionBarCommandButton
												ariaLabel={CommandCenter.title(NAV_BACK)}
												commandId={NAV_BACK}
												icon={ThemeIcon.fromId('chevron-left')}
											/>
											<ActionBarCommandButton
												ariaLabel={CommandCenter.title(NAV_FORWARD)}
												commandId={NAV_FORWARD}
												icon={ThemeIcon.fromId('chevron-right')}
											/>
										</ActionBarRegion>
									)}
									<ActionBarRegion location='center'>
										<TopActionBarCommandCenter />
									</ActionBarRegion>
									{showFullCenterUI && (
										<ActionBarRegion justify='left' location='right' width={60} />
									)}
								</PositronActionBar>
							</ActionBarRegion>
						)}
						<ActionBarRegion gap={6} location='right'>
							<TopActionBarSessionManager />
							{showCenterUI && (
								<TopActionBarCustomFolderMenu />
							)}
						</ActionBarRegion>
					</PositronActionBar>
				</div>
			</PositronActionBarContextProvider>
		</PositronTopActionBarContextProvider>
	);
};
