/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./secondaryInterpreter';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterActions';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * SecondaryInterpreterProps interface.
 */
interface SecondaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	dismiss: () => void;
}

/**
 * SecondaryInterpreter component.
 * @param props A SecondaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const SecondaryInterpreter = (props: SecondaryInterpreterProps) => {
	// State hooks.
	// const [runtimeState, setRuntimeState] = useState(props.runtime.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// // Add the onDidChangeRuntimeState event handler.
		// disposableStore.add(props.runtime.onDidChangeRuntimeState(runtimeState => {
		// 	setRuntimeState(runtimeState);
		// }));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='secondary-interpreter'>
			<div></div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.runtime}
				primaryRuntime={false}
			/>
		</div>
	);
};
