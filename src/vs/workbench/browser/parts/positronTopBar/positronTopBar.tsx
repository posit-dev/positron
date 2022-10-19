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
			<TopBarButton classNameBackground='new-file-background' dropDown={true} />
			<TopBarSeparator />
			<TopBarButton classNameBackground='new-project-background' />
			<TopBarSeparator />
			<TopBarButton classNameBackground='open-file-background' dropDown={true} />
			<TopBarSeparator />
			<TopBarButton classNameBackground='save-background' />
			<TopBarButton classNameBackground='save-all-background' />
			<TopBarSeparator />
			<TopBarButton classNameBackground='print-background' />
		</div>
	);
};
