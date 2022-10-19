/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';

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
	// Render.
	return (
		<div className='positron-top-bar'>
			<TopBarButton iconClassName='new-file-icon' dropDown={true} />
			<TopBarSeparator />
			<TopBarButton iconClassName='new-project-icon' />
			<TopBarSeparator />
			<TopBarButton iconClassName='open-file-icon' dropDown={true} />
			<TopBarSeparator />
			<TopBarButton iconClassName='save-icon' />
			<TopBarButton iconClassName='save-all-icon' />
			<TopBarSeparator />
			<TopBarButton iconClassName='print-icon' />
		</div>
	);
};
