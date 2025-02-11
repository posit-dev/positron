/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBar.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { isAuxiliaryWindow } from '../../../../../base/browser/window.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronDataExplorerContext } from '../../positronDataExplorerContext.js';
import { LayoutMenuButton } from './components/layoutMenuButton.js';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * Localized strings.
 */
const clearSortButtonTitle = localize('positron.clearSortButtonTitle', "Clear Sorting");
const clearSortButtonDescription = localize('positron.clearSortButtonDescription', "Clear sorting");
const moveIntoNewWindowButtonDescription = localize(
	'positron.moveIntoNewWindowButtonDescription',
	"Move into New Window"
);

/**
 * ActionBar component.
 * @returns The rendered component.
 */
export const ActionBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [moveIntoNewWindowDisabled, setMoveIntoNewWindowDisabled] = useState(true);

	// Main useEffect.
	useEffect(() => {
		setMoveIntoNewWindowDisabled(isAuxiliaryWindow(DOM.getWindow(ref.current)));
	}, []);

	// Render.
	return (
		<PositronActionBarContextProvider {...context}>
			<div ref={ref} className='action-bar'>
				<PositronActionBar
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					size='small'
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							ariaLabel={clearSortButtonDescription}
							iconId='positron-clear-sorting'
							text={clearSortButtonTitle}
							tooltip={clearSortButtonDescription}
							onPressed={async () =>
								await context.instance.tableDataDataGridInstance.
									clearColumnSortKeys()
							}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<LayoutMenuButton />
						<ActionBarButton
							ariaLabel={moveIntoNewWindowButtonDescription}
							disabled={moveIntoNewWindowDisabled}
							iconId='positron-open-in-new-window'
							tooltip={moveIntoNewWindowButtonDescription}
							onPressed={() =>
								context.commandService.executeCommand(
									'workbench.action.moveEditorToNewWindow'
								)
							}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
