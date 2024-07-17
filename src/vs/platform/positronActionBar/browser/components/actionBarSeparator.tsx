/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarSeparator';
import * as React from 'react';
import { optionalBoolean, positronClassNames } from 'vs/base/common/positronUtilities';

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
			className={positronClassNames(
				'action-bar-separator',
				{ 'fade-in': optionalBoolean(props.fadeIn) }
			)}
			aria-hidden='true' >
			<div className='action-bar-separator-icon codicon codicon-positron-separator' />
		</div>
	);
};
