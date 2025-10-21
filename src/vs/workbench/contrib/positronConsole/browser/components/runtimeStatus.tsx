/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// React.
import React from 'react';

// Other dependencies.
import { asCssVariable } from '../../../../../platform/theme/common/colorUtils.js';
import { POSITRON_CONSOLE_STATE_ICON_ACTIVE, POSITRON_CONSOLE_STATE_ICON_DISCONNECTED } from '../../../../common/theme.js';
import { ColorIdentifier } from '../../../../../base/common/themables.js';

export const enum RuntimeStatus {
	Active = 'Active',
	Disconnected = 'Disconnected',
	Idle = 'Idle'
}

const enum StatusIconClassName {
	Active = 'codicon-positron-status-active',
	Disconnected = 'codicon-positron-status-disconnected',
	Idle = 'codicon-positron-status-idle'
}

const statusToIconClass: Record<RuntimeStatus, StatusIconClassName> = {
	[RuntimeStatus.Active]: StatusIconClassName.Active,
	[RuntimeStatus.Disconnected]: StatusIconClassName.Disconnected,
	[RuntimeStatus.Idle]: StatusIconClassName.Idle
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
	const iconClass = statusToIconClass[status];
	const iconColor = statusToIconColor[status];
	const iconColorCss = asCssVariable(iconColor);
	return (
		<span
			className={`codicon ${iconClass}`}
			style={{ color: iconColorCss }}
		/>
	);
};
