/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataToolActionBar';

// React.
import * as React from 'react';

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
import { LayoutMenuButton } from 'vs/base/browser/ui/positronDataTool/components/dataToolActionBar/components/layoutMenuButton';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * Localized strings.
 */
const clearSortButtonTitle = localize('positron.clearSortButtonLabel', "Clear Sorting");
const clearSortButtonDescription = localize('positron.clearSortButtonDescription', "Clear sorting");

/**
 * DataToolActionBarProps interface.
 */
interface DataToolActionBarProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * DataToolActionBar component.
 * @param props An DataToolActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataToolActionBar = (props: DataToolActionBarProps) => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// Constants.
	const showDeveloperUI = IsDevelopmentContext.getValue(context.contextKeyService);

	// Render.
	return (
		<PositronActionBarContextProvider {...context}>
			<div className='data-tool-action-bar'>
				<PositronActionBar
					size='small'
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							disabled={false}
							iconId='positron-clear-sorting'
							text={clearSortButtonTitle}
							tooltip={clearSortButtonDescription}
							ariaLabel={clearSortButtonDescription}
							onPressed={() => context.instance.dataGridInstance.clearColumnSortKeys()}
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
								onPressed={() => console.log('HERE')}
							/>
						}
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
