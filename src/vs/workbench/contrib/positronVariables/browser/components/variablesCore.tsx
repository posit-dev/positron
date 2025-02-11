/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesCore.css';

// React.
import React from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBars } from './actionBars.js';
import { PositronVariablesProps } from '../positronVariables.js';
import { VariablesInstance } from './variablesInstance.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';

// VariablesCoreProps interface.
interface VariablesCoreProps extends PositronVariablesProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * VariablesCore component.
 * @param props A VariablesCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesCore = (props: VariablesCoreProps) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// If there are no instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronVariablesContext.positronVariablesInstances.length) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Render.
	return (
		<div className='variables-core'>
			<ActionBars {...props} />
			<div className='variables-instances-container' style={{ width: props.width, height: adjustedHeight }}>
				{positronVariablesContext.positronVariablesInstances.map(positronVariablesInstance =>
					<VariablesInstance
						key={positronVariablesInstance.session.sessionId}
						active={positronVariablesInstance === positronVariablesContext.activePositronVariablesInstance}
						height={adjustedHeight}
						positronVariablesInstance={positronVariablesInstance}
						reactComponentContainer={props.reactComponentContainer}
						width={props.width} />
				)}
			</div>
		</div>
	);
};
