/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarFilter } from 'vs/platform/positronActionBar/browser/components/actionBarFilter';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { SortingMenuButton } from 'vs/workbench/contrib/positronEnvironment/browser/components/sortingMenuButton';
import { GroupingMenuButton } from 'vs/workbench/contrib/positronEnvironment/browser/components/groupingMenuButton';
import { PositronEnvironmentServices } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentState';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { EnvironmentInstanceMenuButton } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentInstanceMenuButton';
import { showDeleteEnvironmentVariablesModalDialog } from 'vs/workbench/contrib/positronEnvironment/browser/modalDialogs/deleteEnvironmentVariablesModalDialog';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 14;
const kPaddingRight = 8;
const kFilterTimeout = 800;

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps extends PositronEnvironmentServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
}

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// State hooks.
	const [filterText, setFilterText] = useState('');

	// Find text change handler.
	useEffect(() => {
		if (filterText === '') {
			positronEnvironmentContext.activePositronEnvironmentInstance?.setFilterText('');
			return;
		} else {
			// Start the filter timeout.
			const filterTimeout = setTimeout(() => {
				positronEnvironmentContext.activePositronEnvironmentInstance?.setFilterText(
					filterText
				);
			}, kFilterTimeout);

			// Clear the find timeout.
			return () => clearTimeout(filterTimeout);
		}
	}, [filterText]);

	/**
	 * deleteAllEnvironmentVariables event handler.
	 */
	const deleteAllEnvironmentVariablesHandler = async () => {
		// Show the delete environment variables modal dialog. If the user confirmed the operation,
		// do it.
		const result = await showDeleteEnvironmentVariablesModalDialog(props.layoutService);
		if (result) {
			positronEnvironmentContext.activePositronEnvironmentInstance?.requestClear(
				result.includeHiddenVariables
			);
		}
	};

	/**
	 * refreshEnvironmentVariablesHandler event handler
	 */
	const refreshEnvironmentVariablesHandler = () => {
		positronEnvironmentContext.activePositronEnvironmentInstance?.requestRefresh();
	};

	// If there are no language environment, return null.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (positronEnvironmentContext.positronEnvironmentInstances.length === 0) {
		return null;
	}

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar size='small' paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion align='left'>
						<GroupingMenuButton />
						<SortingMenuButton />
						{/* Disabled for Private Alpha <ActionBarButton iconId='positron-import-data' text='Import Dataset' dropDown={true} /> */}
					</ActionBarRegion>
					<ActionBarRegion align='right'>
						<ActionBarButton align='right' iconId='positron-trash-can' tooltip={localize('positronDeleteAllEnvironmentVariables', "Delete all environment variables")} onClick={deleteAllEnvironmentVariablesHandler} />
						<ActionBarSeparator />
						<ActionBarButton align='right' iconId='positron-refresh' tooltip={localize('positronRefreshVariables', "Refresh environment variables")} onClick={refreshEnvironmentVariablesHandler} />
					</ActionBarRegion>
				</PositronActionBar>
				<PositronActionBar size='small' gap={kSecondaryActionBarGap} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion align='left'>
						<EnvironmentInstanceMenuButton />
						{/* Disabled for Private Alpha <ActionBarButton iconId='positron-environment' text='Global Environment' dropDown={true} tooltip={localize('positronSelectEnvironment', "Select environment")} /> */}
					</ActionBarRegion>
					<ActionBarRegion align='right'>
						<ActionBarFilter
							width={150}
							initialFilterText={filterText}
							onFilterTextChanged={filterText => setFilterText(filterText)} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
