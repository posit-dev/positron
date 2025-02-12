/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarFilter } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { SortingMenuButton } from './sortingMenuButton.js';
import { GroupingMenuButton } from './groupingMenuButton.js';
import { PositronVariablesServices } from '../positronVariablesState.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { VariablesInstanceMenuButton } from './variablesInstanceMenuButton.js';
import { DeleteAllVariablesModalDialog } from '../modalDialogs/deleteAllVariablesModalDialog.js';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;
const kFilterTimeout = 800;

/**
 * Localized strings.
 */
const positronRefreshObjects = localize('positronRefreshObjects', "Refresh objects");
const positronDeleteAllObjects = localize('positronDeleteAllObjects', "Delete all objects");

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps extends PositronVariablesServices {
	readonly layoutService: IWorkbenchLayoutService;
}

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// State hooks.
	const [filterText, setFilterText] = useState('');

	// Find text change handler.
	useEffect(() => {
		if (filterText === '') {
			positronVariablesContext.activePositronVariablesInstance?.setFilterText('');
			return;
		} else {
			// Start the filter timeout.
			const filterTimeout = setTimeout(() => {
				positronVariablesContext.activePositronVariablesInstance?.setFilterText(
					filterText
				);
			}, kFilterTimeout);

			// Clear the find timeout.
			return () => clearTimeout(filterTimeout);
		}
	}, [filterText, positronVariablesContext.activePositronVariablesInstance]);

	/**
	 * Delete all objects event handler.
	 */
	const deleteAllObjectsHandler = async () => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: props.keybindingService,
			layoutService: props.layoutService,
			container: props.layoutService.activeContainer
		});

		// Show the delete all variables modal dialog.
		renderer.render(
			<DeleteAllVariablesModalDialog
				deleteAllVariablesAction={async deleteAllVariablesResult =>
					positronVariablesContext.activePositronVariablesInstance?.requestClear(
						deleteAllVariablesResult.includeHiddenObjects
					)
				}
				renderer={renderer}
			/>
		);
	};

	/**
	 * Refresh objects event handler
	 */
	const refreshObjectsHandler = () => {
		positronVariablesContext.activePositronVariablesInstance?.requestRefresh();
	};

	// If there are no instances, return null.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (positronVariablesContext.positronVariablesInstances.length === 0) {
		return null;
	}

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					size='small'
				>
					<ActionBarRegion location='left'>
						<GroupingMenuButton />
						<SortingMenuButton />
						{/* Disabled for Private Alpha <ActionBarButton iconId='positron-import-data' text='Import Dataset' dropDown={true} /> */}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={positronRefreshObjects}
							iconId='positron-refresh'
							tooltip={positronRefreshObjects}
							onPressed={refreshObjectsHandler}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={positronDeleteAllObjects}
							iconId='clear-all'
							tooltip={positronDeleteAllObjects}
							onPressed={deleteAllObjectsHandler}
						/>
					</ActionBarRegion>
				</PositronActionBar>
				<PositronActionBar
					borderBottom={true}
					gap={kSecondaryActionBarGap}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					size='small'
				>
					<ActionBarRegion location='left'>
						<VariablesInstanceMenuButton />
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarFilter
							initialFilterText={filterText}
							width={150}
							onFilterTextChanged={filterText => setFilterText(filterText)} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
