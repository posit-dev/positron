/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TopBarCommandCenter } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandCenter/topBarCommandCenter';
import { TopBarRegion } from 'vs/workbench/browser/parts/positronTopBar/components/topBarRegion/topBarRegion';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';
import { TooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps {
	quickInputService: IQuickInputService;
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
			<TopBarRegion align='left'>
				<TopBarButton tooltipManager={hoverManager} iconClassName='new-file-icon' dropDown={true} />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='new-project-icon' />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='open-file-icon' dropDown={true} />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='save-icon' />
				<TopBarButton tooltipManager={hoverManager} iconClassName='save-all-icon' />
			</TopBarRegion>

			<TopBarRegion align='center'>
				<TopBarButton iconClassName='back-icon' />
				<TopBarButton iconClassName='forward-icon' />
				<TopBarCommandCenter {...props} />
			</TopBarRegion>

			<TopBarRegion align='right'>
				<TopBarButton iconClassName='print-icon' />
			</TopBarRegion>
		</div>
	);
};
