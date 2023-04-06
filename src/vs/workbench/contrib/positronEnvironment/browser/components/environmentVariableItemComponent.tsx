/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableItemComponent';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';

/**
 * EnvironmentVariableItemComponentProps interface.
 */
export interface EnvironmentVariableItemComponentProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	typeVisible: boolean;
	indentLevel: number;
	environmentVariableItem: EnvironmentVariableItem;
}

/**
 * EnvironmentVariableItemComponent component.
 * @param props A EnvironmentVariableItemComponentProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableItemComponent = (props: EnvironmentVariableItemComponentProps) => {
	// Hooks.
	const [selected, _setSelected] = useState(false);
	const [expanded, setExpanded] = useState(false);

	/**
	 * Handles expand / collapse.
	 */
	const handleExpandCollapse = async () => {
		if (expanded) {
			setExpanded(false);
			// setChildren(undefined);
		} else {
			setExpanded(true);
			// setChildren(await props.environmentVariableItem.loadChildren());
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
			<div className='name' style={{ width: props.nameColumnWidth }}>
				<div style={{ display: 'flex', marginLeft: props.indentLevel * 20 }}>
					<div className='gutter'>
						{props.environmentVariableItem.hasChildren && (
							<button className='expand-collapse-button' onClick={handleExpandCollapse}>
								{!expanded ?
									<div className={`expand-collapse-button-icon codicon codicon-chevron-right`}></div> :
									<div className={`expand-collapse-button-icon codicon codicon-chevron-down`}></div>
								}
							</button>
						)}
					</div>
					<div className='name-value'>
						{props.environmentVariableItem.displayName}
					</div>
				</div>
			</div>
			<div className='details' style={{ width: props.detailsColumnWidth }}>
				<div className='value'>{props.environmentVariableItem.displayValue}</div>
				{props.typeVisible && (
					<div className='type'>
						{props.environmentVariableItem.displayType}
					</div>
				)}
			</div>
		</div>
	</>);
};
