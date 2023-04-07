/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableItem';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
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
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableItem component.
 * @param props A EnvironmentVariableItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableItem = ({
	nameColumnWidth,
	detailsColumnWidth,
	typeVisible,
	environmentVariableItem,
	positronEnvironmentInstance
}: EnvironmentVariableItemProps) => {
	// Hooks.
	const [selected, _setSelected] = useState(false);

	/**
	 * Handles expand / collapse.
	 */
	const handleExpandCollapse = async () => {
		if (environmentVariableItem.expanded) {
			positronEnvironmentInstance.collapseEnvironmentVariable(environmentVariableItem.path);
		} else {
			positronEnvironmentInstance.expandEnvironmentVariable(environmentVariableItem.path);
		}
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-variable',
		{ 'selected': selected }
	);

	// Render.
	return (<>
		<div className={classNames}>
			<div className='name' style={{ width: nameColumnWidth }}>
				<div style={{ display: 'flex', marginLeft: environmentVariableItem.indentLevel * 20 }}>
					<div className='gutter'>
						{environmentVariableItem.hasChildren && (
							<button className='expand-collapse-button' onClick={handleExpandCollapse}>
								{!environmentVariableItem.expanded ?
									<div className={`expand-collapse-button-icon codicon codicon-chevron-right`}></div> :
									<div className={`expand-collapse-button-icon codicon codicon-chevron-down`}></div>
								}
							</button>
						)}
					</div>
					<div className='name-value'>
						{environmentVariableItem.displayName}
					</div>
				</div>
			</div>
			<div className='details' style={{ width: detailsColumnWidth }}>
				<div className='value'>{environmentVariableItem.displayValue}</div>
				{typeVisible && (
					<div className='type'>
						{environmentVariableItem.displayType}
					</div>
				)}
			</div>
		</div>
	</>);
};
