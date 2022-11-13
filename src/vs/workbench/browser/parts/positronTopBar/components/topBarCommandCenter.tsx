/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarCommandCenter';
import * as React from 'react';
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { TopBarSelectBox } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSelectBox';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';

/**
 * TopBarCommandCenterProps interface.
 */
interface TopBarCommandCenterProps { }

/**
 * TopBarCommandCenter component.
 * @param props A TopBarCommandCenterProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandCenter = (props: TopBarCommandCenterProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();

	// Handlers.
	const clickHandler = () => {
		positronTopBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	const dropDownClickHandler = () => {
		positronTopBarContext.quickInputService.quickAccess.show('?');
	};

	// Render.
	return (
		<TopBarSelectBox className='top-bar-command-center' onClick={clickHandler} onDropDownClick={dropDownClickHandler}>
			<span className='codicon codicon-search'></span>
			<span>Search</span>
		</TopBarSelectBox>
	);
};
