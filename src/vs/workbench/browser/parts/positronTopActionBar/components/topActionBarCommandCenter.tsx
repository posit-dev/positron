/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarCommandCenter';
import * as React from 'react';
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { TopActionBarSelectBox } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarSelectBox';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

/**
 * TopActionBarCommandCenterProps interface.
 */
interface TopActionBarCommandCenterProps { }

/**
 * TopActionBarCommandCenter component.
 * @param props A TopActionBarCommandCenterProps that contains the component properties.
 * @returns The component.
 */
export const TopActionBarCommandCenter = (props: TopActionBarCommandCenterProps) => {
	// Hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Handlers.
	const clickHandler = () => {
		positronTopActionBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	const dropDownClickHandler = () => {
		positronTopActionBarContext.quickInputService.quickAccess.show('?');
	};

	// Render.
	return (
		<TopActionBarSelectBox className='top-action-bar-command-center' onClick={clickHandler} onDropDownClick={dropDownClickHandler}>
			<span className='codicon codicon-search'></span>
			<span>Search</span>
		</TopActionBarSelectBox>
	);
};
