/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBars } from 'vs/workbench/contrib/positronVariables/browser/components/actionBars';
import { PositronVariablesProps } from 'vs/workbench/contrib/positronVariables/browser/positronVariables';
import { VariablesInstance } from 'vs/workbench/contrib/positronVariables/browser/components/variablesInstance';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';

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
						width={props.width}
						height={adjustedHeight}
						positronVariablesInstance={positronVariablesInstance}
						reactComponentContainer={props.reactComponentContainer} />
				)}
			</div>
		</div>
	);
};
