/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './primaryInterpreter.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { InterpreterActions } from './interpreterActions.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * PrimaryInterpreterProps interface.
 */
interface PrimaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	runtime: ILanguageRuntimeMetadata;
	enableShowAllVersions: boolean;
	onShowAllVersions: () => void;
	onStart: () => void;
	onActivate: () => void;
}

/**
 * PrimaryInterpreter component.
 * @param props A PrimaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const PrimaryInterpreter = (props: PrimaryInterpreterProps) => {
	// Get a console session for this runtime, if it exists.
	const consoleSession =
		props.runtimeSessionService.getConsoleSessionForRuntime(props.runtime.runtimeId);

	// State hooks.
	const [runtimeState, setRuntimeState] = useState(consoleSession ? consoleSession.getRuntimeState() :
		RuntimeState.Uninitialized);
	const [session, setSession] = useState(consoleSession);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// If a console session exists, listen for changes to its runtime state.
		if (session) {
			disposableStore.add(session.onDidChangeRuntimeState(runtimeState => {
				setRuntimeState(runtimeState);
			}));
		}

		// Listen for new console sessions that are started. When a new session
		// is started for the runtime that this component is managing, attach to
		// it.
		disposableStore.add(props.runtimeSessionService.onWillStartSession(e => {
			if (e.session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
				e.session.runtimeMetadata.runtimeId === props.runtime.runtimeId) {
				setSession(session);
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.runtime.runtimeId, props.runtimeSessionService, session]);

	// Render.
	return (
		<PositronButton className='primary-interpreter' onPressed={props.onActivate}>
			<div className='running-indicator'>
				{runtimeState !== RuntimeState.Uninitialized && runtimeState !== RuntimeState.Exited &&
					<div className='running-icon codicon codicon-circle-large-filled'></div>
				}
			</div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.runtimeName}</div>
					<div className='line light' title={props.runtime.runtimePath}>{props.runtime.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.runtime}
				runtimeSessionService={props.runtimeSessionService}
				onStart={props.onStart}>
				{props.enableShowAllVersions &&
					<PositronButton className='action-button' onPressed={props.onShowAllVersions}>
						<span
							className='codicon codicon-positron-more-options'
							title={(() => localize('positronShowAllVersions', "Show all versions"))()}
						/>
					</PositronButton>
				}
			</InterpreterActions>
		</PositronButton>
	);
};
