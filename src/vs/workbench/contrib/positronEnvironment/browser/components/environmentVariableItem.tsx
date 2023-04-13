/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableItem';
import * as React from 'react';
import { CSSProperties, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ColumnSplitter } from 'vs/workbench/contrib/positronEnvironment/browser/components/columnSplitter';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentVariableItemProps interface.
 */
export interface EnvironmentVariableItemProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	typeVisible: boolean;
	environmentVariableItem: IEnvironmentVariableItem;
	focused: boolean;
	selected: boolean;
	style: CSSProperties;
	onStartResizeNameColumn: () => void;
	onResizeNameColumn: (x: number, y: number) => void;
	onStopResizeNameColumn: (x: number, y: number) => void;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableItem component.
 * @param props A EnvironmentVariableItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableItem = (props: EnvironmentVariableItemProps) => {
	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	/**
	 * Handles onClick events.
	 */
	const handleClick = () => {
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-variable',
		{ 'selected': props.selected }
	);

	// Render.
	return (
		<div ref={ref} className={classNames} onClick={handleClick} style={props.style}>
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div style={{ display: 'flex', marginLeft: props.environmentVariableItem.indentLevel * 20 }}>
					<div className='gutter'>
						{props.environmentVariableItem.hasChildren && (
							props.environmentVariableItem.expanded ?
								<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
								<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
						)}
					</div>
					<div className='name-value'>
						{props.environmentVariableItem.displayName}
					</div>
				</div>
			</div>
			<ColumnSplitter
				onStartResize={props.onStartResizeNameColumn}
				onResize={props.onResizeNameColumn}
				onStopResize={props.onStopResizeNameColumn} />
			<div className='details-column' style={{ width: props.detailsColumnWidth, minWidth: props.detailsColumnWidth }}>
				<div className='value'>
					{props.environmentVariableItem.displayValue}
				</div>
				{props.typeVisible && (
					<div className='type'>
						{props.environmentVariableItem.displayType}
					</div>
				)}
			</div>
		</div>
	);
};
