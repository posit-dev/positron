/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceState.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

const enum StatusIconClassName {
	ACTIVE = 'codicon-positron-status-active',
	DISCONNECTED = 'codicon-positron-status-disconnected',
	IDLE = 'codicon-positron-status-idle'
}

const statusIconClassNameToColor = {
	[StatusIconClassName.ACTIVE]: 'var(--vscode-positronConsole-stateIconActive)',
	[StatusIconClassName.DISCONNECTED]: 'var(--vscode-positronConsole-stateIconDisconnected)',
	[StatusIconClassName.IDLE]: 'var(--vscode-positronConsole-stateIconIdle)'
}

const consoleStateToStatusIcon = {
	[PositronConsoleState.Uninitialized]: StatusIconClassName.DISCONNECTED,
	[PositronConsoleState.Disconnected]: StatusIconClassName.DISCONNECTED,
	[PositronConsoleState.Starting]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Busy]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Ready]: StatusIconClassName.IDLE,
	[PositronConsoleState.Offline]: StatusIconClassName.DISCONNECTED,
	[PositronConsoleState.Exiting]: StatusIconClassName.ACTIVE,
	[PositronConsoleState.Exited]: StatusIconClassName.DISCONNECTED
};

interface ConsoleInstanceStateProps {
	readonly positronConsoleInstance: IPositronConsoleInstance;
}

export const ConsoleInstanceState = ({ positronConsoleInstance }: ConsoleInstanceStateProps) => {
	// State hooks
	const [consoleState, setConsoleState] = useState(positronConsoleInstance.state);

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(positronConsoleInstance.onDidChangeState(state => {
			setConsoleState(state)
		}));

		return () => disposableStore.dispose();
	}, [positronConsoleInstance]);

	const icon = consoleStateToStatusIcon[consoleState];
	const color = statusIconClassNameToColor[icon];

	return (
		<span
			className={`codicon ${icon}`}
			style={{ color }}
		/>
	);
}
