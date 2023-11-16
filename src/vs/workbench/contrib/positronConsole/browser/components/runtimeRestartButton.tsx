/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeRestartButton';
import * as nls from 'vs/nls';
import * as React from 'react';
import { RuntimeItemRestartButton } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemRestartButton';

// RuntimeRestartButtonProps interface.
export interface RuntimeRestartButtonProps {
	runtimeItemRestartButton: RuntimeItemRestartButton;
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
			<span className='codicon codicon-debug-restart'></span>
			<span className='label'>{restartLabel}</span>
		</button>
	);
};
