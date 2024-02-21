/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./secondaryInterpreter';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterActions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * SecondaryInterpreterProps interface.
 */
interface SecondaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntimeMetadata;
	onStart: () => void;
	onActivate: () => void;
}

/**
 * SecondaryInterpreter component.
 * @param props A SecondaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const SecondaryInterpreter = (props: SecondaryInterpreterProps) => {
	// State hooks.

	// TODO: Need to get the runtime state from the service.
	// How should this work?

	// const [runtimeState, setRuntimeState] = useState(props.runtime.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler.
		/*
		TODO: When the runtime state changes, update the state.
		disposableStore.add(props.runtime.onDidChangeRuntimeState(runtimeState => {
			setRuntimeState(runtimeState);
		}));
		*/

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronButton className='secondary-interpreter' onPressed={props.onActivate}>
			<div></div>
			<div className='running-indicator'>
				{false &&
					<div className='running-icon codicon codicon-circle-large-filled'></div>
				}
			</div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.runtimeShortName}</div>
					<div className='line light' title={props.runtime.runtimePath}>{props.runtime.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.runtime}
				onStart={props.onStart} />
		</PositronButton>
	);
};
