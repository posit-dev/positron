/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { HeaderRow } from 'vs/workbench/contrib/positronEnvironment/browser/components/headerRow';
import { EnvironmentVariable } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariable';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
import { EnvironmentVariableValueKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { sortEnvironmentVariableItemsByName, sortEnvironmentVariableItemsBySize } from 'vs/workbench/contrib/positronEnvironment/common/utils';
import { IPositronEnvironmentInstance, PositronEnvironmentGrouping } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

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
			props.positronEnvironmentInstance.onDidChangeEnvironmentVariableItems(() => {
				setMarker(generateUuid());
			})
		);

		// Add the onDidChangeEnvironmentItems event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentGrouping(() => {
				setMarker(generateUuid());
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Temporary logging.
	console.log(`+++++++++++++ Rendering EnvironmentInstance for marker ${marker}`);

	/**
	 * Renders environment.
	 * @returns The rendered environment.
	 */
	const renderEnvironment = () => {
		// Render based in grouping.
		switch (props.positronEnvironmentInstance.environmentGrouping) {
			case PositronEnvironmentGrouping.None:
				return renderItems(
					props.positronEnvironmentInstance.environmentVariableItems.concat(),
					'name'
				);

			case PositronEnvironmentGrouping.Kind:
				return renderEnvironmentVariableItemsGroupedByKind(
					props.positronEnvironmentInstance.environmentVariableItems
				);

			case PositronEnvironmentGrouping.Size:
				return renderItems(
					props.positronEnvironmentInstance.environmentVariableItems.concat(),
					'size'
				);
		}
	};

	/**
	 * Renders environment variable items grouped by kind.
	 * @returns The rendered environment variable items.
	 */
	const renderEnvironmentVariableItemsGroupedByKind = (items: EnvironmentVariableItem[]) => {
		// Break the environment variable items into groups.
		const dataItems: EnvironmentVariableItem[] = [];
		const valueItems: EnvironmentVariableItem[] = [];
		const functionItems: EnvironmentVariableItem[] = [];
		props.positronEnvironmentInstance.environmentVariableItems.forEach(item => {
			if (item.kind === EnvironmentVariableValueKind.Table) {
				dataItems.push(item);
			} else if (item.kind === EnvironmentVariableValueKind.Function) {
				functionItems.push(item);
			} else {
				valueItems.push(item);
			}
		});

		// Render the groups.
		return (<>
			{dataItems.length !== 0 && <>
				<HeaderRow title='Data' />
				{renderItems(dataItems, 'name')}
			</>}
			{valueItems.length !== 0 && <>
				<HeaderRow title='Values' />
				{renderItems(valueItems, 'name')}
			</>}
			{functionItems.length !== 0 && <>
				<HeaderRow title='Functions' />
				{renderItems(functionItems, 'name')}
			</>}
		</>);
	};

	/**
	 * Renders environment variable items.
	 * @param items The environment variable items to render.
	 * @returns The rendered environment variable items.
	 */
	const renderItems = (items: EnvironmentVariableItem[], sortBy: 'name' | 'size') => {
		// Sort the environment variable items.
		if (sortBy === 'name') {
			sortEnvironmentVariableItemsByName(items);
		} else {
			sortEnvironmentVariableItemsBySize(items);
		}

		// Return the environment variable items.
		return items.map(item => {
			return <EnvironmentVariable key={item.id} indentLevel={0} environmentVariableItem={item} />;
		});
	};

	// Render.
	return (
		<div className='environment-instance' hidden={props.hidden}>
			{renderEnvironment()}
		</div>
	);
};
