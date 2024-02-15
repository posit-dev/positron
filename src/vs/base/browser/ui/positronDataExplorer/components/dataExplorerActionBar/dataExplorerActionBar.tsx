/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataExplorerActionBar';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { LayoutMenuButton } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerActionBar/components/layoutMenuButton';

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
 * DataExplorerActionBarProps interface.
 */
interface DataExplorerActionBarProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * DataExplorerActionBar component.
 * @param props An DataExplorerActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataExplorerActionBar = (props: DataExplorerActionBarProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();


	// Render.
	return (
		<PositronActionBarContextProvider {...context}>
			<div className='data-explorer-action-bar'>
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
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<LayoutMenuButton />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
