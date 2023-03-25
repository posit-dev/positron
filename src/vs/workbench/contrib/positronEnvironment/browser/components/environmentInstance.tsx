/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { EnvironmentVariable } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariable';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
import { EnvironmentVariableValueKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { EnvironmentVariablesGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariablesGroup';
import { EnvironmentVariablesContainer } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariablesContainer';
import { sortEnvironmentVariableItemsByName, sortEnvironmentVariableItemsBySize } from 'vs/workbench/contrib/positronEnvironment/common/utils';
import { IPositronEnvironmentInstance, PositronEnvironmentGrouping } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentInstanceProps interface.
 */
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
	const [dataExpanded, setDataExpanded] = useState(true);
	const [valuesExpanded, setValuesExpanded] = useState(true);
	const [functionsExpanded, setFunctionsExpanded] = useState(true);

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
			// None.
			case PositronEnvironmentGrouping.None:
				return renderItems(
					props.positronEnvironmentInstance.environmentVariableItems.concat(),
					'name'
				);

			// Kind.
			case PositronEnvironmentGrouping.Kind:
				return renderEnvironmentVariableItemsGroupedByKind(
					props.positronEnvironmentInstance.environmentVariableItems
				);

			// Size.
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
				<EnvironmentVariablesGroup
					title='Data'
					expanded={dataExpanded}
					onExpand={() => setDataExpanded(true)}
					onCollapse={() => setDataExpanded(false)}
					onToggleExpandCollapse={() => setDataExpanded(!dataExpanded)}>
					<EnvironmentVariablesContainer>
						{renderItems(dataItems, 'name')}
					</EnvironmentVariablesContainer>
				</EnvironmentVariablesGroup>
			</>}
			{valueItems.length !== 0 && <>
				<EnvironmentVariablesGroup
					title='Values'
					expanded={valuesExpanded}
					onExpand={() => setValuesExpanded(true)}
					onCollapse={() => setValuesExpanded(false)}
					onToggleExpandCollapse={() => setValuesExpanded(!valuesExpanded)}>
					<EnvironmentVariablesContainer>
						{renderItems(valueItems, 'name')}
					</EnvironmentVariablesContainer>
				</EnvironmentVariablesGroup>
			</>}
			{functionItems.length !== 0 && <>
				<EnvironmentVariablesGroup
					title='Functions'
					expanded={functionsExpanded}
					onExpand={() => setFunctionsExpanded(true)}
					onCollapse={() => setFunctionsExpanded(false)}
					onToggleExpandCollapse={() => setFunctionsExpanded(!functionsExpanded)}>
					<EnvironmentVariablesContainer>
						{renderItems(functionItems, 'name')}
					</EnvironmentVariablesContainer>
				</EnvironmentVariablesGroup>
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
		return <EnvironmentVariablesContainer>
			{items.map(item =>
				<EnvironmentVariable key={item.id} indentLevel={0} environmentVariableItem={item} />
			)}
		</EnvironmentVariablesContainer>;
	};

	// Render.
	return (
		<div className='environment-instance' hidden={props.hidden}>
			{renderEnvironment()}
		</div>
	);
};
