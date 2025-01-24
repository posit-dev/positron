/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';

const positronConsoleInfo = localize('positronConsoleInfo', "Console information");

export const ConsoleInstanceInfoButton = () => {
	return (
		<ActionBarButton
			iconId='info'
			align='right'
			tooltip={positronConsoleInfo}
			ariaLabel={positronConsoleInfo}
		/>
	)
};
