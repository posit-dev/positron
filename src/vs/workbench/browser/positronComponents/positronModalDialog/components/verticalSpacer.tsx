/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './verticalSpacer.css';

// React.
import { PropsWithChildren } from 'react';

/**
 * VerticalSpacer component.
 */
export const VerticalSpacer = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='vertical-spacer'>
			{props.children}
		</div>
	);
};
