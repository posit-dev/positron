/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
 * @returns The rendered component.
 */
export const TopActionBarCommandCenter = (props: TopActionBarCommandCenterProps) => {
	// Hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Ckick handler.
	const clickHandler = () => {
		positronTopActionBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	// DropDownCkick handler.
	const dropDownClickHandler = () => {
		positronTopActionBarContext.quickInputService.quickAccess.show('?');
	};

	// Render.
	return (
		<TopActionBarSelectBox className='top-action-bar-command-center' onClick={clickHandler} onDropDownClick={dropDownClickHandler}>
			<div className='left'>
				{/* <div className='codicon codicon-search'></div> */}
			</div>
			<div className='center'>
				Search
			</div>
			<div className='right'></div>
		</TopActionBarSelectBox>
	);
};
