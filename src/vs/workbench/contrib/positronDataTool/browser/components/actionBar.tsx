/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBar';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * ActionBarProps interface.
 */
interface ActionBarProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * ActionBar component.
 * @param props An ActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBar = (props: ActionBarProps) => {
	// Context hooks.
	const positronDataToolContext = usePositronDataToolContext();

	// Constants.
	// const showDeveloperUI = IsDevelopmentContext.getValue(positronDataToolContext.contextKeyService);

	// State hooks.

	// Main useEffect hook.
	useEffect(() => {
	}, []);

	// Render.
	return (
		<PositronActionBarContextProvider {...positronDataToolContext}>
			<div className='action-bar'>
				<PositronActionBar
					size='small'
					borderTop={true}
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
