/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarCommandCenter';
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';

import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';

const React = require('react');


/**
 * TopBarCommandCenterProps interface.
 */
interface TopBarCommandCenterProps {
	quickInputService: IQuickInputService;
}

/**
 * TopBarCommandCenter component.
 * @param props A TopBarCommandCenterProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandCenter = (props: TopBarCommandCenterProps) => {

	// Handlers.
	const searchClickHandler = () => {
		props.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	const chevronClickHandler = () => {
		props.quickInputService.quickAccess.show('?');
	};


	// Render.
	return (
		<div className={`top-bar-command-center`}>
			<div className='top-bar-command-center-search' onClick={searchClickHandler}>
				<span className='codicon codicon-search'></span>
				<span>Search</span>
			</div>

			<div className='top-bar-command-center-chevron' onClick={chevronClickHandler}>
				<span className='codicon codicon-chevron-down'></span>
			</div>
		</div>
	);
};
