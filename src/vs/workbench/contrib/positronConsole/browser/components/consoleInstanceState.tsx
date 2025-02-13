/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceState.css';

// React
import React from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

const enum StatusIconClassName {
	ACTIVE = 'codicon-positron-status-active',
	DISCONNECTED = 'codicon-positron-status-disconnected',
	IDLE = 'codicon-positron-status-idle'
}

// TODO: use or create theme var colors
const statusIconClassNameToColor = {
	[StatusIconClassName.ACTIVE]: 'blue',
	[StatusIconClassName.DISCONNECTED]: 'red',
	[StatusIconClassName.IDLE]: 'green',
}

const consoleStateToStatusIcon = {
	[PositronConsoleState.Uninitialized]: StatusIconClassName.DISCONNECTED,
	[PositronConsoleState.Starting]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Busy]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Ready]: StatusIconClassName.IDLE,
	[PositronConsoleState.Offline]: StatusIconClassName.DISCONNECTED,
	[PositronConsoleState.Exiting]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Exited]: StatusIconClassName.DISCONNECTED,
};

interface ConsoleInstanceStateProps {
	sessionId: string;
}

export const ConsoleInstanceState = ({ sessionId }: ConsoleInstanceStateProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	const consoleInstance = positronConsoleContext.positronConsoleInstances.find(
		instance => instance.session.sessionId === sessionId);

	const state = consoleInstance?.state || PositronConsoleState.Uninitialized;
	const icon = consoleStateToStatusIcon[state];
	const color = statusIconClassNameToColor[icon];

	return (
		<span
			className={`codicon ${icon}}`}
			style={{ color }}
		/>
	);
}
