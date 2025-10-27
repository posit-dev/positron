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
import { RuntimeStatus, RuntimeStatusIcon } from './runtimeStatus.js';

const consoleStateToRuntimeStatus = {
	[PositronConsoleState.Uninitialized]: RuntimeStatus.Disconnected,
	[PositronConsoleState.Disconnected]: RuntimeStatus.Disconnected,
	[PositronConsoleState.Starting]: RuntimeStatus.Active,
	[PositronConsoleState.Busy]: RuntimeStatus.Active,
	[PositronConsoleState.Ready]: RuntimeStatus.Idle,
	[PositronConsoleState.Offline]: RuntimeStatus.Disconnected,
	[PositronConsoleState.Exiting]: RuntimeStatus.Active,
	[PositronConsoleState.Exited]: RuntimeStatus.Disconnected
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

	const runtimeStatus = consoleStateToRuntimeStatus[consoleState];

	return (
		<RuntimeStatusIcon status={runtimeStatus} />
	);
}
