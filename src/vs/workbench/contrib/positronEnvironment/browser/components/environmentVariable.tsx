/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariable';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';

/**
 * EnvironmentVariableProps interface.
 */
export interface EnvironmentVariableProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	typeVisible: boolean;
	indentLevel: number;
	environmentVariableItem: EnvironmentVariableItem;
}

/**
 * EnvironmentVariable component.
 * @param props A EnvironmentVariableProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariable = (props: EnvironmentVariableProps) => {
	// Hooks.
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<EnvironmentVariableItem[] | undefined>(undefined);

	/**
	 * Handles expand / collapse.
	 */
	const handleExpandCollapse = async () => {
		if (expanded) {
			setExpanded(false);
			setChildren(undefined);
		} else {
			setExpanded(true);
			setChildren(await props.environmentVariableItem.loadChildren());
		}
	};

	// Render.
	return (<>
		<div className='environment-variable'>
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
		{expanded && children && children.map(item =>
			<EnvironmentVariable
				key={item.id}
				nameColumnWidth={props.nameColumnWidth}
				detailsColumnWidth={props.detailsColumnWidth}
				typeVisible={props.typeVisible}
				indentLevel={props.indentLevel + 1}
				environmentVariableItem={item} />
		)}
	</>);
};
