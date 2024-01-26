/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBar';

// React.
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { usePositronDataToolContext } from 'vs/base/browser/ui/positronDataTool/positronDataToolContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { LayoutMenuButton } from 'vs/base/browser/ui/positronDataTool/components/actionBar/components/layoutMenuButton';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * Localized strings.
 */
const clearSortButtonTitle = localize('positron.clearSortButtonLabel', "Clear Sort");
const clearSortButtonDescription = localize('positron.clearSortButtonDescription', "Clear sort");

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
	const showDeveloperUI = IsDevelopmentContext.getValue(positronDataToolContext.contextKeyService);

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
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							disabled={false}
							iconId='positron-clear-sort'
							text={clearSortButtonTitle}
							tooltip={clearSortButtonDescription}
							ariaLabel={clearSortButtonDescription}
							onClick={() => console.log('HERE')}
						/>
						<ActionBarSeparator />
						<LayoutMenuButton />
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						{showDeveloperUI &&
							<ActionBarButton
								iconId='clear-all'
								align='right'
								tooltip='Clear'
								ariaLabel='Clear'
								onClick={() => console.log('HERE')}
							/>
						}
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
