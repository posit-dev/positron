/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstance';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { EnvironmentVariableItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableItem';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentVariableGroup';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { EnvironmentEntry, IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * Constants.
 */
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const TYPE_VISIBILITY_THRESHOLD = 250;

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
	const [resizingColumn, setResizingColumn] = useState(false);
	const [nameColumnWidth, setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH);
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
		// Calculate the new details column width.
		const newDetailsColumnWidth = Math.max(
			props.width - nameColumnWidth,
			Math.trunc(props.width / 3)
		);

		// Adjust the column widths.
		setNameColumnWidth(props.width - newDetailsColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the type visibility.
		setTypeVisible(newDetailsColumnWidth > TYPE_VISIBILITY_THRESHOLD);
	}, [props.width]);

	/**
	 * startResizeNameColumn event handler.
	 */
	const startResizeNameColumnHandler = () => {
		setResizingColumn(true);
	};

	/**
	 * resizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const resizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
	};

	/**
	 * stopResizeNameColumn event handler.
	 * @param x The X delta.
	 */
	const stopResizeNameColumnHandler = (x: number) => {
		resizeNameColumn(x);
		setResizingColumn(false);
	};

	/**
	 * Resizes the name column.
	 * @param x The X delta.
	 */
	const resizeNameColumn = (x: number) => {
		// Calculate the new column widths.
		const newNameColumnWidth = Math.min(
			Math.max(nameColumnWidth + x, MINIMUM_NAME_COLUMN_WIDTH),
			Math.trunc(2 * props.width / 3)
		);
		const newDetailsColumnWidth = props.width - newNameColumnWidth;

		// Adjust the column widths.
		setNameColumnWidth(newNameColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the type visibility.
		setTypeVisible(newDetailsColumnWidth > TYPE_VISIBILITY_THRESHOLD);
	};

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
						detailsColumnWidth={detailsColumnWidth - 1}
						typeVisible={typeVisible}
						environmentVariableItem={entry}
						positronEnvironmentInstance={props.positronEnvironmentInstance}
						onStartResizeNameColumn={startResizeNameColumnHandler}
						onResizeNameColumn={resizeNameColumnHandler}
						onStopResizeNameColumn={stopResizeNameColumnHandler}
					/>
				);
			} else {
				// It's a bug to get here.
				return null;
			}
		});
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-instance',
		{ 'resizing': resizingColumn }
	);

	// Render.
	return (
		<div className={classNames} hidden={props.hidden}>
			{renderEntries()}
		</div>
	);
};
