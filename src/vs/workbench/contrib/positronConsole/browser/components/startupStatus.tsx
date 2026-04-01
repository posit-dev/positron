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
import { RuntimeStartupProgress } from './runtimeStartupProgress.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';

// Load localized copy for control.
const initalizing = localize('positron.console.initializing', "Waiting for extensions");
const awaitingTrust = localize('positron.console.awaitingTrust', "Cannot start consoles in Restricted Mode. [Trust this folder](command:workbench.trust.manage) to enable consoles.");
const newFolderTasks = localize('positron.console.newFolderTasks', "Setting up workspace");
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
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const progressRef = React.useRef<HTMLDivElement>(null);

	// Component state.
	const [discovered, setDiscovered] =
		useState(services.languageRuntimeService.registeredRuntimes.length);
	const [startupPhase, setStartupPhase] =
		useState(services.languageRuntimeService.startupPhase);
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
			services.languageRuntimeService.onDidRegisterRuntime(
				_runtime => {
					setDiscovered(
						services.languageRuntimeService.registeredRuntimes.length);
				}));

		// When the startup phase changes, update the phase.
		disposableStore.add(
			services.languageRuntimeService.onDidChangeRuntimeStartupPhase(
				phase => {
					setStartupPhase(phase);
				}));

		// When we're notified that a runtime may auto-start in the workspace,
		// show it. Note that this event is not reliable as a signal that a
		// runtime will actually start; see notes in the RuntimeStartupService.
		disposableStore.add(
			services.runtimeStartupService.onWillAutoStartRuntime(
				evt => {
					// Ignore auto-start events that won't activate to avoid
					// flickering between several runtimes starting up
					if (evt.activate) {
						setRuntimeStartupEvent(evt);
					}
				}));

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			bar?.done();
			disposableStore.dispose();
		};
	}, [services.languageRuntimeService, services.runtimeStartupService]);

	// Whether we are awaiting workspace trust. In this state we show a
	// static message and hide the progress bar.
	const isAwaitingTrust = startupPhase === RuntimeStartupPhase.AwaitingTrust;

	// Render. The progress bar div must always be in the DOM so that the
	// ref is available when the useEffect creates the ProgressBar instance;
	// it is hidden during the AwaitingTrust phase via display:none.
	return (
		<div className='startup-status'>
			<div ref={progressRef} className='progress'
				style={isAwaitingTrust ? { display: 'none' } : undefined}></div>
			{runtimeStartupEvent &&
				<RuntimeStartupProgress evt={runtimeStartupEvent} />
			}
			{startupPhase === RuntimeStartupPhase.Initializing &&
				<div className='initializing'>{initalizing}...</div>
			}
			{startupPhase === RuntimeStartupPhase.Reconnecting && !runtimeStartupEvent &&
				<div className='reconnecting'>{reconnecting}...</div>
			}
			{isAwaitingTrust &&
				<div className='awaiting'><EmbeddedLink>{awaitingTrust}</EmbeddedLink></div>
			}
			{startupPhase === RuntimeStartupPhase.NewFolderTasks &&
				<div className='new-folder-tasks'>{newFolderTasks}...</div>
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
