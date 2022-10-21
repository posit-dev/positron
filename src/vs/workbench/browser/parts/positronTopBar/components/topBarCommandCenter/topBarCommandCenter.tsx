/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarCommandCenter';
const React = require('react');
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';

/**
 * TopBarCommandCenterProps interface.
 */
interface TopBarCommandCenterProps {
}

/**
 * TopBarCommandCenter component.
 * @param props A TopBarCommandCenterProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandCenter = (props: TopBarCommandCenterProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();

	// Handlers.
	const searchClickHandler = () => {
		positronTopBarContext?.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	const chevronClickHandler = () => {
		positronTopBarContext?.quickInputService.quickAccess.show('?');
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
