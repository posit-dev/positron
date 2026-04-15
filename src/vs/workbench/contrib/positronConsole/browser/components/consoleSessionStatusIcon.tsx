/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { RuntimeStatusIcon } from './runtimeStatus.js';
import { runtimeStateToRuntimeStatus } from '../../common/sessionDisplayUtils.js';

interface ConsoleSessionStatusIconProps {
	readonly positronConsoleInstance: IPositronConsoleInstance;
}

export const ConsoleSessionStatusIcon = ({ positronConsoleInstance }: ConsoleSessionStatusIconProps) => {
	// Get the initial runtime state from the attached session, or default to
	// Uninitialized if no session is attached.
	const getInitialRuntimeState = () =>
		positronConsoleInstance.attachedRuntimeSession?.getRuntimeState() ?? RuntimeState.Uninitialized;

	// State hooks
	const [runtimeState, setRuntimeState] = useState<RuntimeState>(getInitialRuntimeState);

	// Listen for runtime state changes on the attached session.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		const session = positronConsoleInstance.attachedRuntimeSession;
		if (session) {
			// Sync state in case it changed between render and effect.
			setRuntimeState(session.getRuntimeState());

			disposableStore.add(session.onDidChangeRuntimeState(state => {
				setRuntimeState(state);
			}));
		}

		return () => disposableStore.dispose();
	}, [positronConsoleInstance.attachedRuntimeSession]);

	const runtimeStatus = runtimeStateToRuntimeStatus[runtimeState];

	return (
		<RuntimeStatusIcon status={runtimeStatus} />
	);
};
