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
	// The set of exit reasons for which we will provide a way to manually restart.
	const reason = props.runtimeItemExited.reason;
	const offerRestart = reason === RuntimeExitReason.Shutdown || reason ===
		RuntimeExitReason.ForcedQuit;

	const restartLabel = nls.localize('positron.restartLabel', "Restart {0}", props.runtimeItemExited.languageName);

	// Render.
	return (
		<>
			<div className='runtime-exited'>
				<OutputLines outputLines={props.runtimeItemExited.outputLines} />
			</div>
			{offerRestart &&
				<button className='monaco-text-button runtime-restart-button'>
					<span className='codicon codicon-debug-restart'></span>
					<span className='label'>{restartLabel}</span>
				</button>}
		</>
	);
};
