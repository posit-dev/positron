/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { EnvironmentVariableItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableItem';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableGroup';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { EnvironmentEntry, IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * Constants.
 */
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const TYPE_VISIBILITY_THRESHOLD = 400;

/**
 * isEnvironmentVariableGroup user-defined type guard.
 * @param entry The entry.
 * @returns Whether the entry is IEnvironmentVariableGroup.
 */
const isEnvironmentVariableGroup = (entry: EnvironmentEntry): entry is IEnvironmentVariableGroup => {
	return 'title' in entry;
};

/**
 * isEnvironmentVariableItem user-defined type guard.
 * @param entry The entry.
 * @returns Whether the entry is IEnvironmentVariableItem.
 */
const isEnvironmentVariableItem = (entry: IEnvironmentVariableItem | IEnvironmentVariableItem): entry is IEnvironmentVariableItem => {
	return 'path' in entry;
};

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
	const [nameColumnWidth, _setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH - 1);
	const [typeVisible, setTypeVisible] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH > TYPE_VISIBILITY_THRESHOLD);
	const [entries, setEntries] = useState<EnvironmentEntry[]>([]);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeState event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeState(state => {
				// TODO
			})
		);

		// Add the onDidChangeEnvironmentGrouping event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentGrouping(() => {
				// For the moment, simply re-render everything.
				// setMarker(generateUuid());
			})
		);

		// Add the onDidChangeEnvironmentItems event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEnvironmentSorting(() => {
				// For the moment, simply re-render everything.
				// setMarker(generateUuid());
			})
		);

		// Add the onDidChangeEntries event handler.
		disposableStore.add(
			props.positronEnvironmentInstance.onDidChangeEntries(entries =>
				setEntries(entries)
			)
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Width use effect.
	useEffect(() => {
		setDetailsColumnWidth(props.width - nameColumnWidth - 1);
		setTypeVisible(props.width > TYPE_VISIBILITY_THRESHOLD);
	}, [props.width]);

	/**
	 * Renders the entries.
	 * @returns The rendered entries.
	 */
	const renderEntries = () => {
		return entries.map(entry => {
			if (isEnvironmentVariableGroup(entry)) {
				return (
					<EnvironmentVariableGroup
						key={entry.id}
						environmentVariableGroup={entry}
						positronEnvironmentInstance={props.positronEnvironmentInstance} />
				);
			} else if (isEnvironmentVariableItem(entry)) {
				return (
					<EnvironmentVariableItem
						key={entry.id}
						nameColumnWidth={nameColumnWidth}
						detailsColumnWidth={detailsColumnWidth}
						typeVisible={typeVisible}
						environmentVariableItem={entry}
						positronEnvironmentInstance={props.positronEnvironmentInstance} />
				);
			} else {
				// It's a bug to get here.
				return null;
			}
		});
	};

	// Render.
	return (
		<div className='environment-instance' hidden={props.hidden}>
			{renderEntries()}
		</div>
	);
};
