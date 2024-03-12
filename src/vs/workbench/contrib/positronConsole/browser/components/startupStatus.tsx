/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./startupStatus';
import * as React from 'react';
import { localize } from 'vs/nls';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

// eslint-disable-next-line no-duplicate-imports
import { useEffect, useState } from 'react';

// Load localized copy for control.
const initalizing = localize('positron.console.initializing', "Starting up");
const awaitingTrust = localize('positron.console.awaitingTrust', "Consoles cannot start until the workspace is trusted");
const reconnecting = localize('positron.console.reconnecting', "Reconnecting");
const starting = localize('positron.console.starting', "Starting");
const discoveringIntrepreters = localize('positron.console.discoveringInterpreters', "Discovering interpreters");

/**
 * StartupStatus component.
 *
 * This component shows the startup status in the Positron Console; it is shown
 * only until startup is finished or a console is started (whichever comes
 * first).
 *
 * @returns The rendered component.
 */
export const StartupStatus = () => {
	const progressRef = React.useRef<HTMLDivElement>(null);

	const positronConsoleContext = usePositronConsoleContext();

	// Component state.
	const [discovered, setDiscovered] =
		useState(positronConsoleContext.languageRuntimeService.registeredRuntimes.length);
	const [startupPhase, setStartupPhase] =
		useState(positronConsoleContext.runtimeStartupService.startupPhase);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Create a progress bar and add it to the disposable store.
		let bar: ProgressBar | undefined;
		if (progressRef.current) {
			bar = new ProgressBar(progressRef.current);
			// Infinite progress since we don't know how many interpreters we're discovering.
			bar.infinite();
			disposableStore.add(bar);
		}

		// When each interpreter is discovered, update the count.
		disposableStore.add(
			positronConsoleContext.languageRuntimeService.onDidRegisterRuntime(
				_runtime => {
					setDiscovered(
						positronConsoleContext.languageRuntimeService.registeredRuntimes.length);
				}));

		// When the startup phase changes, update the phase.
		disposableStore.add(
			positronConsoleContext.runtimeStartupService.onDidChangeRuntimeStartupPhase(
				phase => {
					setStartupPhase(phase);
				}));

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			bar?.done();
			disposableStore.dispose();
		};
	});

	// Render.
	return (
		<div className='startup-status'>
			<div className='progress' ref={progressRef}></div>
			{startupPhase === RuntimeStartupPhase.Initializing &&
				<div className='initializing'>{initalizing}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Reconnecting &&
				<div className='initializing'>{reconnecting}...</div>
			}
			{startupPhase === RuntimeStartupPhase.AwaitingTrust &&
				<div className='awaiting'>{awaitingTrust}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Starting &&
				<div className='starting'>{starting}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Discovering &&
				<div className='discovery'>{discoveringIntrepreters}
					{discovered > 0 && <span> ({discovered})</span>}...</div>
			}
		</div>
	);
};
