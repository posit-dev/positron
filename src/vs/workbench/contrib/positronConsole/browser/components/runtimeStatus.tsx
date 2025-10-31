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
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { localize } from '../../../../../nls.js';
import { asCssVariable, ColorIdentifier } from '../../../../../platform/theme/common/colorUtils.js';

export const enum RuntimeStatus {
	Active = 'Active',
	Disconnected = 'Disconnected',
	Idle = 'Idle'
}

const positronRuntimeStatusActiveIcon = registerIcon(
	'positron-runtime-status-active',
	Codicon.positronStatusActive,
	localize('positronRuntimeStatusActiveIcon', 'Icon to indicate the \'active\' status of an interpreter session.')
);

const positronRuntimeStatusDisconnectedIcon = registerIcon(
	'positron-runtime-status-disconnected',
	Codicon.positronStatusDisconnected,
	localize('positronRuntimeStatusDisconnectedIcon', 'Icon to indicate the \'disconnected\' status of an interpreter session.')
);

const positronRuntimeStatusIdleIcon = registerIcon(
	'positron-runtime-status-idle',
	Codicon.positronStatusIdle,
	localize('positronRuntimeStatusIdleIcon', 'Icon to indicate the \'idle\' status of an interpreter session.')
);

const statusToIcon: Record<RuntimeStatus, ThemeIcon> = {
	[RuntimeStatus.Active]: positronRuntimeStatusActiveIcon,
	[RuntimeStatus.Disconnected]: positronRuntimeStatusDisconnectedIcon,
	[RuntimeStatus.Idle]: positronRuntimeStatusIdleIcon,
};

const statusToIconColor: Record<RuntimeStatus, ColorIdentifier> = {
	[RuntimeStatus.Active]: POSITRON_CONSOLE_STATE_ICON_ACTIVE,
	[RuntimeStatus.Disconnected]: POSITRON_CONSOLE_STATE_ICON_DISCONNECTED,
	[RuntimeStatus.Idle]: POSITRON_CONSOLE_STATE_ICON_IDLE,
};

export interface RuntimeStatusIconProps {
	status: RuntimeStatus;
}

export const RuntimeStatusIcon = ({ status }: RuntimeStatusIconProps) => {
	const icon = statusToIcon[status];
	const className = ThemeIcon.asClassName(icon);
	const color = statusToIconColor[status];
	const colorCss = asCssVariable(color);
	return (
		<span
			className={className}
			style={{
				color: colorCss,
				animation: status === RuntimeStatus.Active ? 'spin 2s linear infinite' : undefined
			}}
		/>
	);
};
