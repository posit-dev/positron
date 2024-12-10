/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeRestartButton.css';

// React.
import React, { useEffect } from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import { RuntimeItemRestartButton } from '../../../../services/positronConsole/browser/classes/runtimeItemRestartButton.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

// RuntimeRestartButtonProps interface.
export interface RuntimeRestartButtonProps {
	runtimeItemRestartButton: RuntimeItemRestartButton;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * RuntimeRestartButton component.
 *
 * @param props A RuntimeRestartButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeRestartButton = (props: RuntimeRestartButtonProps) => {

	const restartRef = React.useRef<HTMLButtonElement>(null);
	const restartLabel = nls.localize('positron.restartLabel', "Restart {0}", props.runtimeItemRestartButton.languageName);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(props.positronConsoleInstance.onFocusInput(() => {
			// Focus the button when the Console takes focus, i.e. when the
			// user clicks somewhere on the console output
			restartRef.current?.focus();
		}));

		return () => disposableStore.dispose();
	}, [props.positronConsoleInstance]);

	const handleRestart = () => {
		// Invoke the restart callback.
		props.runtimeItemRestartButton.onRestartRequested();

		// Disable the restart button so it can't be mashed.
		if (restartRef.current) {
			restartRef.current.disabled = true;
		}
	};

	// Render.
	return (
		<button ref={restartRef}
			className='monaco-text-button runtime-restart-button'
			onClick={handleRestart}>
			<span className='codicon codicon-positron-restart-runtime'></span>
			<span className='label'>{restartLabel}</span>
		</button>
	);
};
