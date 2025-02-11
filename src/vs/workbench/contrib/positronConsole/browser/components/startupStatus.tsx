/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './startupStatus.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { RuntimeStartupProgress } from './runtimeStartupProgress.js';

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
		useState(positronConsoleContext.languageRuntimeService.startupPhase);
	const [runtimeStartupEvent, setRuntimeStartupEvent] =
		useState<IRuntimeAutoStartEvent | undefined>(undefined);

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
			positronConsoleContext.languageRuntimeService.onDidChangeRuntimeStartupPhase(
				phase => {
					setStartupPhase(phase);
				}));

		// When we're notified that a runtime may auto-start in the workspace,
		// show it. Note that this event is not reliable as a signal that a
		// runtime will actually start; see notes in the RuntimeStartupService.
		disposableStore.add(
			positronConsoleContext.runtimeStartupService.onWillAutoStartRuntime(
				evt => {
					setRuntimeStartupEvent(evt);
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
			<div ref={progressRef} className='progress'></div>
			{runtimeStartupEvent &&
				<RuntimeStartupProgress evt={runtimeStartupEvent} />
			}
			{startupPhase === RuntimeStartupPhase.Initializing &&
				<div className='initializing'>{initalizing}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Reconnecting && !runtimeStartupEvent &&
				<div className='reconnecting'>{reconnecting}...</div>
			}
			{startupPhase === RuntimeStartupPhase.AwaitingTrust &&
				<div className='awaiting'>{awaitingTrust}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Starting && !runtimeStartupEvent &&
				<div className='starting'>{starting}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Discovering && !runtimeStartupEvent &&
				<div className='discovery'>{discoveringIntrepreters}
					{discovered > 0 && <span> ({discovered})</span>}...</div>
			}
		</div>
	);
};
