/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./primaryInterpreter';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterActions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

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
	}, []);

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
				runtime={props.runtime}
				onStart={props.onStart}
				languageRuntimeService={props.languageRuntimeService}
				runtimeSessionService={props.runtimeSessionService}>
				{props.enableShowAllVersions &&
					<PositronButton className='action-button' onPressed={props.onShowAllVersions}>
						<span
							className='codicon codicon-positron-more-options'
							title={localize('positronShowAllVersions', "Show all versions")}
						/>
					</PositronButton>
				}
			</InterpreterActions>
		</PositronButton>
	);
};
