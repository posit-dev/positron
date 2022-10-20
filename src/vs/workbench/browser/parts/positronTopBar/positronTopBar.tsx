/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';
import { TooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps {
}

/**
 * PositronTopBar component.
 * @param props A PositronTopBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBar = (props: PositronTopBarProps) => {
	// Hooks.
	const [hoverManager] = useState(new TooltipManager());

	// Render.
	return (
		<div className='positron-top-bar'>
			<TopBarButton tooltipManager={hoverManager} iconClassName='new-file-icon' dropDown={true} tooltip='New File' />
			<TopBarSeparator />
			<TopBarButton tooltipManager={hoverManager} iconClassName='new-project-icon' tooltip='New Project' />
			<TopBarSeparator />
			<TopBarButton tooltipManager={hoverManager} iconClassName='open-file-icon' dropDown={true} tooltip='Open File' />
			<TopBarSeparator />
			<TopBarButton tooltipManager={hoverManager} iconClassName='save-icon' tooltip='Save' />
			<TopBarButton tooltipManager={hoverManager} iconClassName='save-all-icon' tooltip='Save All' />
			<TopBarSeparator />
			<TopBarButton tooltipManager={hoverManager} iconClassName='print-icon' tooltip='Print' />
		</div>
	);
};
