/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroup';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IInterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { PrimaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/primaryInterpreter';
import { SecondaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/secondaryInterpreter';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * InterpreterGroupProps interface.
 */
interface InterpreterGroupProps {
	languageRuntimeService: ILanguageRuntimeService;
	interpreterGroup: IInterpreterGroup;
	onStartRuntime: (runtime: ILanguageRuntime) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntime) => Promise<void>;
}

/**
 * InterpreterGroup component.
 * @param props A InterpreterGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterGroup = (props: InterpreterGroupProps) => {
	/**
	 * Determines whether an alternate runtime is alive.
	 * @returns A value which indicates whether an alternate runtime is alive.
	 */
	const isAlternateRuntimeAlive = () => {
		// If any of the alternate runtimes are alive, return true.
		for (const runtime of props.interpreterGroup.alternateRuntimes) {
			const runtimeState = runtime.getRuntimeState();
			switch (runtimeState) {
				case RuntimeState.Initializing:
				case RuntimeState.Starting:
				case RuntimeState.Ready:
				case RuntimeState.Idle:
				case RuntimeState.Busy:
				case RuntimeState.Restarting:
				case RuntimeState.Exiting:
				case RuntimeState.Offline:
				case RuntimeState.Interrupting:
					return true;
			}
		}

		// An alternate runtime is not alive.
		return false;
	};

	// State hooks.
	const [alternateRuntimeAlive, setAlternateRuntimeAlive] = useState(isAlternateRuntimeAlive());
	const [showAllVersions, setShowAllVersions] = useState(isAlternateRuntimeAlive());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler for the primary runtime.
		disposableStore.add(
			props.interpreterGroup.primaryRuntime.onDidChangeRuntimeState(runtimeState => {
				const alternateRuntimeAlive = isAlternateRuntimeAlive();
				setAlternateRuntimeAlive(alternateRuntimeAlive);
				if (alternateRuntimeAlive) {
					setShowAllVersions(true);
				}
			})
		);

		// Add the onDidChangeRuntimeState event handler for the alternate runtimes.
		for (const runtime of props.interpreterGroup.alternateRuntimes) {
			disposableStore.add(runtime.onDidChangeRuntimeState(runtimeState => {
				const alternateRuntimeAlive = isAlternateRuntimeAlive();
				setAlternateRuntimeAlive(alternateRuntimeAlive);
				if (alternateRuntimeAlive) {
					setShowAllVersions(true);
				}
			}));
		}

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='interpreter-group'>
			<PrimaryInterpreter
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.interpreterGroup.primaryRuntime}
				enableShowAllVersions={props.interpreterGroup.alternateRuntimes.length > 0}
				onShowAllVersions={() => setShowAllVersions(!showAllVersions)}
				onStart={async () => await props.onStartRuntime(props.interpreterGroup.primaryRuntime)}
				onActivate={async () => await props.onActivateRuntime(props.interpreterGroup.primaryRuntime)}
			/>
			{(alternateRuntimeAlive || showAllVersions) &&
				<div className='secondary-interpreters'>
					{props.interpreterGroup.alternateRuntimes.map(runtime =>
						<SecondaryInterpreter
							key={runtime.metadata.runtimeId}
							languageRuntimeService={props.languageRuntimeService}
							runtime={runtime}
							onStart={async () => await props.onStartRuntime(runtime)}
							onActivate={async () => await props.onActivateRuntime(runtime)}
						/>
					)}
				</div>
			}
		</div>
	);
};
