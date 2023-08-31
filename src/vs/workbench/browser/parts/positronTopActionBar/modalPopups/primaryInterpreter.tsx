/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./primaryInterpreter';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterActions';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PrimaryInterpreterProps interface.
 */
interface PrimaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
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
	// State hooks.
	const [runtimeState, setRuntimeState] = useState(props.runtime.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler.
		disposableStore.add(props.runtime.onDidChangeRuntimeState(runtimeState => {
			setRuntimeState(runtimeState);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronButton className='primary-interpreter' onClick={props.onActivate}>
			<div className='running-indicator'>
				{runtimeState !== RuntimeState.Uninitialized && runtimeState !== RuntimeState.Exited &&
					<div className='running-icon codicon codicon-circle-large-filled'></div>
				}
			</div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.runtimeName}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions runtime={props.runtime} onStart={props.onStart}>
				{props.enableShowAllVersions &&
					<PositronButton className='action-button' onClick={props.onShowAllVersions}>
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
