/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeExited';
import * as nls from 'vs/nls';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemExited';
import { RuntimeExitReason } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// RuntimeExitedProps interface.
export interface RuntimeExitedProps {
	runtimeItemExited: RuntimeItemExited;
}

/**
 * RuntimeExited component.
 * @param props A RuntimeExitedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeExited = (props: RuntimeExitedProps) => {

	const restartRef = React.useRef<HTMLButtonElement>(null);

	// Offer a restart if the runtime was shut down by user, and we have a
	// restart callback to invoke.
	const reason = props.runtimeItemExited.reason;
	const offerRestart = props.runtimeItemExited.onRestartRequested &&
		(reason === RuntimeExitReason.Shutdown || reason ===
			RuntimeExitReason.ForcedQuit);

	const restartLabel = nls.localize('positron.restartLabel', "Restart {0}", props.runtimeItemExited.languageName);

	const handleRestart = () => {
		// Invoke the restart callback.
		if (props.runtimeItemExited.onRestartRequested) {
			props.runtimeItemExited.onRestartRequested();
		}

		// Disable, and then hide, the restart button.
		if (restartRef.current) {
			restartRef.current.disabled = true;
		}
		setTimeout(() => {
			if (restartRef.current) {
				restartRef.current.style.display = 'none';
			}
		}, 1000);
	};

	// Render.
	return (
		<>
			<div className='runtime-exited'>
				<OutputLines outputLines={props.runtimeItemExited.outputLines} />
			</div>
			{offerRestart &&
				<button ref={restartRef}
					className='monaco-text-button runtime-restart-button'
					onClick={handleRestart}>
					<span className='codicon codicon-debug-restart'></span>
					<span className='label'>{restartLabel}</span>
				</button>}
		</>
	);
};
