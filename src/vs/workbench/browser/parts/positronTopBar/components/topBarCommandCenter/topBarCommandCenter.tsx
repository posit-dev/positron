/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarCommandCenter';
import React = require('react');
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { TopBarSelectBox } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSelectBox/topBarSelectBox';
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

	if (!positronTopBarContext) {
		return null;
	}

	// Handlers.
	const searchClickHandler = () => {
		positronTopBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	const chevronClickHandler = () => {
		positronTopBarContext.quickInputService.quickAccess.show('?');
	};

	// Render.
	return (
		<TopBarSelectBox className='top-bar-command-center' onClick={searchClickHandler} onDropDownClick={chevronClickHandler}>
			<span className='codicon codicon-search'></span>
			<span>Search</span>
		</TopBarSelectBox>
	);
};
