/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBar';
import * as React from 'react';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { TopBarNewMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarNewMenu';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { TopBarOpenMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarOpenMenu';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { TopBarWorkspaceMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarWorkspaceMenu';
import { PositronTopBarContextProvider } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { ActionBarCommandButton } from 'vs/platform/positronActionBar/browser/components/actionBarCommandButton';
import { NavigateBackwardsAction, NavigateForwardAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { TopBarCommandCenter } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandCenter/topBarCommandCenter';

/**
 * PositronTopBarServices interface. Defines the set of services that are required by the Positron top bar.
 */
export interface PositronTopBarServices extends PositronActionBarServices {
	hostService: IHostService;
	labelService: ILabelService;
	layoutService: ILayoutService;
	quickInputService: IQuickInputService;
	workspaceContextService: IWorkspaceContextService;
	workspacesService: IWorkspacesService;
	languageRuntimeService: ILanguageRuntimeService;
}

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps extends PositronTopBarServices { }

/**
 * PositronTopBar component.
 * @param props A PositronTopBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBar = (props: PositronTopBarProps) => {
	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<PositronTopBarContextProvider {...props}>
				<div className='positron-top-bar'>
					<ActionBarRegion align='left'>
						<TopBarNewMenu />
						<ActionBarSeparator />
						<TopBarOpenMenu />
						<ActionBarSeparator />
						<ActionBarCommandButton iconId='positron-save' commandId={'workbench.action.files.save'} />
						<ActionBarCommandButton iconId='positron-save-all' commandId={'workbench.action.files.saveFiles'} />
					</ActionBarRegion>

					<ActionBarRegion align='center'>
						<ActionBarCommandButton iconId='positron-chevron-left' commandId={NavigateBackwardsAction.ID} />
						<ActionBarCommandButton iconId='positron-chevron-right' commandId={NavigateForwardAction.ID} />
						<TopBarCommandCenter {...props} />
					</ActionBarRegion>

					<ActionBarRegion align='right'>
						<TopBarWorkspaceMenu />
					</ActionBarRegion>
				</div>
			</PositronTopBarContextProvider>
		</PositronActionBarContextProvider>
	);
};
