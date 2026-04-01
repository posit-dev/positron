/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// React.
import React from 'react';

// Other dependencies.
import * as platform from '../../../../../base/common/platform.js';

/**
 * PlatformNativeDialogActionBarProps interface.
 */
interface PlatformNativeDialogActionBarProps {
	secondaryButton?: React.ReactNode,
	primaryButton?: React.ReactNode
}

/**
 * PlatformNativeDialogActionBar component.
 * @param props A PlatformNativeDialogActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlatformNativeDialogActionBar = ({ secondaryButton, primaryButton }: PlatformNativeDialogActionBarProps) => {
	// Render.
	return (
		<>
			{
				platform.isWindows
					? <>{primaryButton}{secondaryButton}</>
					: <>{secondaryButton}{primaryButton}</>
			}
		</>
	)
}
