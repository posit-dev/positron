/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariable';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
// import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentVariableProps interface.
 */
export interface EnvironmentVariableProps {
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
	//const positronEnvironmentContext = usePositronEnvironmentContext();
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
	return (
		<div className='environment-variable-container'>
			<div className='environment-variable'>
				<div className='name'>
					<div style={{ display: 'flex', marginLeft: props.indentLevel * 20 }}>
						<div className='gutter'>
							{props.environmentVariableItem.hasChildren && (
								<button className='expand-collapse-button' onClick={handleExpandCollapse}>
									<div className='expand-collapse-button-face'>
										{!expanded ?
											<div className={`expand-collapse-button-icon codicon codicon-chevron-right`}></div> :
											<div className={`expand-collapse-button-icon codicon codicon-chevron-down`}></div>
										}
									</div>
								</button>
							)}
						</div>
						<div className='name-value'>
							{props.environmentVariableItem.name}
						</div>

					</div>

				</div>
				<div className='value'>{props.environmentVariableItem.value}</div>
			</div>
			{expanded && children && children.map(ss =>
				<EnvironmentVariable key={ss.id} indentLevel={props.indentLevel + 1} environmentVariableItem={ss} />
			)}
		</div>
	);
};
