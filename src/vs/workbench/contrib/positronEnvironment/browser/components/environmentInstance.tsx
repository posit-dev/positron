/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

// EnvironmentInstanceProps interface.
interface EnvironmentInstanceProps {
	hidden: boolean;
	width: number;
	height: number;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentInstance component.
 * @param props A EnvironmentInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentInstance = (props: EnvironmentInstanceProps) => {
	// Hooks.
	//const [marker, setMarker] = useState(generateUuid());

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeState event handler.
		// disposableStore.add(props.positronEnvironmentInstance.onDidChangeState(state => {
		// }));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='environment-instance' hidden={props.hidden}>
			<div>Environment Instance</div>
			{/* {props.positronEnvironmentInstance.runtimeItems.map(runtimeItem =>
				renderRuntimeItem(runtimeItem)
			)} */}
		</div>
	);
};
