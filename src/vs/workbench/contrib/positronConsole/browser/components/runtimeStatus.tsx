/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// React.
import React from 'react';

// Other dependencies.
import { POSITRON_CONSOLE_STATE_ICON_ACTIVE, POSITRON_CONSOLE_STATE_ICON_DISCONNECTED, POSITRON_CONSOLE_STATE_ICON_IDLE } from '../../../../common/theme.js';
import { themeColorFromId, ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { localize } from '../../../../../nls.js';

export const enum RuntimeStatus {
	Active = 'Active',
	Disconnected = 'Disconnected',
	Idle = 'Idle'
}

const positronRuntimeStatusActiveIcon = registerIcon(
	'positron-runtime-status-active',
	{
		...Codicon.positronStatusActive,
		color: themeColorFromId(POSITRON_CONSOLE_STATE_ICON_ACTIVE)
	},
	localize('positronRuntimeStatusActiveIcon', 'Icon to indicate the \'active\' status of an interpreter session.')
);

const positronRuntimeStatusDisconnectedIcon = registerIcon(
	'positron-runtime-status-disconnected',
	{
		...Codicon.positronStatusDisconnected,
		color: themeColorFromId(POSITRON_CONSOLE_STATE_ICON_DISCONNECTED)
	},
	localize('positronRuntimeStatusDisconnectedIcon', 'Icon to indicate the \'disconnected\' status of an interpreter session.')
);

const positronRuntimeStatusIdleIcon = registerIcon(
	'positron-runtime-status-idle',
	{
		...Codicon.positronStatusIdle,
		color: themeColorFromId(POSITRON_CONSOLE_STATE_ICON_IDLE)
	},
	localize('positronRuntimeStatusIdleIcon', 'Icon to indicate the \'idle\' status of an interpreter session.')
);

const statusToIcon: Record<RuntimeStatus, ThemeIcon> = {
	[RuntimeStatus.Active]: positronRuntimeStatusActiveIcon,
	[RuntimeStatus.Disconnected]: positronRuntimeStatusDisconnectedIcon,
	[RuntimeStatus.Idle]: positronRuntimeStatusIdleIcon,
};

export interface RuntimeStatusIconProps {
	status: RuntimeStatus;
}

export const RuntimeStatusIcon = ({ status }: RuntimeStatusIconProps) => {
	const icon = statusToIcon[status];
	const className = ThemeIcon.asClassName(icon);
	return <span className={className} />;
};
