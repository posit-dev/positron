/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarSeparator.css';

// Other dependencies.
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from './icon.js';
import { optionalBoolean, positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * ActionBarSeparatorProps interface.
 */
export interface ActionBarSeparatorProps {
	fadeIn?: boolean;
}

/**
 * ActionBarSeparator component.
 * @returns The component.
 */
export const ActionBarSeparator = (props: ActionBarSeparatorProps) => {
	// Render.
	return (
		<div
			aria-hidden='true'
			className={positronClassNames(
				'action-bar-separator',
				{ 'fade-in': optionalBoolean(props.fadeIn) }
			)} >
			<ThemeIcon className='action-bar-separator-icon' icon={Codicon.positronSeparator} />
		</div>
	);
};
