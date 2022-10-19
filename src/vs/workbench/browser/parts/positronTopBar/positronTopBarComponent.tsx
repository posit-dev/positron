/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBarComponent';
const React = require('react');
import { ButtonComponent } from 'vs/workbench/browser/parts/positronTopBar/components/buttonComponent/buttonComponent';
import { SeparatorComponent } from 'vs/workbench/browser/parts/positronTopBar/components/separatorComponent/separatorComponent';

/**
 * PositronTopBarComponentProps interface.
 */
interface PositronTopBarComponentProps {
}

/**
 * PositronTopBarComponent component.
 * @param props A PositronTopBarComponentProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBarComponent = (props: PositronTopBarComponentProps) => {
	// Render.
	return (
		<div className='positron-top-bar'>
			<ButtonComponent classNameBackground='new-file-background' dropDown={true} />
			<SeparatorComponent />
			<ButtonComponent classNameBackground='new-project-background' />
			<SeparatorComponent />
			<ButtonComponent classNameBackground='open-file-background' dropDown={true} />
			<SeparatorComponent />
			<ButtonComponent classNameBackground='save-background' />
			<ButtonComponent classNameBackground='save-all-background' />
			<SeparatorComponent />
			<ButtonComponent classNameBackground='print-background' />
		</div>
	);
};
