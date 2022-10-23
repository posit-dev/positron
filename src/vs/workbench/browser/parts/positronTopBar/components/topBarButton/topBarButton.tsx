/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarButton';
const React = require('react');
import { forwardRef } from 'react';
import { Tooltip } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';
import { ILocalizedString } from 'vs/platform/action/common/action';

/**
 * TopBarButtonProps interface.
 */
interface TopBarButtonProps {
	iconId: string;
	dropDown?: boolean;
	tooltip?: string | ILocalizedString;
	execute?: VoidFunction;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = forwardRef<HTMLDivElement, TopBarButtonProps>((props: TopBarButtonProps, ref) => {
	// Render.
	return (
		<Tooltip {...props}>
			<div ref={ref} className='top-bar-button' onClick={props.execute}>
				<div className='top-bar-button-face'>
					<div className={`codicon codicon-top-bar-button codicon-${props.iconId}`}></div>
					{props.dropDown && <div className='codicon codicon-top-bar-button-drop-down-arrow codicon-positron-drop-down-arrow' />}
				</div>
			</div>
		</Tooltip>
	);
});
