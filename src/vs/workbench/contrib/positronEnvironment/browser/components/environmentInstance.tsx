/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { EnvironmentItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentItem';
import { EnvironmentItemVariable } from 'vs/workbench/services/positronEnvironment/common/classes/environmentItemVariable';
import { EnvironmentVariable } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariable';

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
	const [marker, setMarker] = useState(generateUuid());

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeState event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeState(state => {
			})
		);

		// Add the onDidChangeEnvironmentItems event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentItems(environmentItems => {
				setMarker(generateUuid());
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * Renders an environment item.
	 * @param environmentItem The runtime item.
	 * @returns The rendered runtime item.
	 */
	const renderEnvironmentItem = (environmentItem: EnvironmentItem) => {
		if (environmentItem instanceof EnvironmentItemVariable) {
			return <EnvironmentVariable key={environmentItem.id} environmentItemVariable={environmentItem} />;
		} else {
			return null;
		}
	};

	// Temporary logging.
	console.log(`+++++++++++++ Rendering EnvironmentInstance for marker ${marker}`);

	// Render.
	return (
		<div className='environment-instance' hidden={props.hidden}>
			{props.positronEnvironmentInstance.environmentItems.map(environmentItem =>
				renderEnvironmentItem(environmentItem)
			)}
		</div>
	);
};
