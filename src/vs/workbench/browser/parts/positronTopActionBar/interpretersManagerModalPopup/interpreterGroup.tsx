/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroup';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IInterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { PrimaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/primaryInterpreter';
import { SecondaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/secondaryInterpreter';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * InterpreterGroupProps interface.
 */
interface InterpreterGroupProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	interpreterGroup: IInterpreterGroup;
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
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
		// Get the active sessions.
		const activeSessions = props.runtimeSessionService.activeSessions;

		// Cross-reference them against the alternate runtimes. If any of the
		// alternate runtimes are alive, return true.
		for (const runtime of props.interpreterGroup.alternateRuntimes) {
			for (const session of activeSessions) {
				if (session.runtimeMetadata.runtimeId === runtime.runtimeId) {
					const runtimeState = session.getRuntimeState();
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

		// Add the onDidChangeRuntimeState event handler; when a runtime changes
		// state, recompute the alive state of the alternate runtimes.
		disposableStore.add(
			props.runtimeSessionService.onDidChangeRuntimeState(e => {
				const alternateRuntimeAlive = isAlternateRuntimeAlive();
				setAlternateRuntimeAlive(alternateRuntimeAlive);
				if (alternateRuntimeAlive) {
					setShowAllVersions(true);
				}
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='interpreter-group'>
			<PrimaryInterpreter
				languageRuntimeService={props.languageRuntimeService}
				runtimeSessionService={props.runtimeSessionService}
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
							key={runtime.runtimeId}
							languageRuntimeService={props.languageRuntimeService}
							runtimeSessionService={props.runtimeSessionService}
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
