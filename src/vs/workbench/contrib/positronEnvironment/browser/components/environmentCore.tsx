/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBars } from 'vs/workbench/contrib/positronEnvironment/browser/components/actionBars';
import { PositronEnvironmentProps } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironment';
import { EnvironmentInstance } from 'vs/workbench/contrib/positronEnvironment/browser/components/environmentInstance';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

// EnvironmentCoreProps interface.
interface EnvironmentCoreProps extends PositronEnvironmentProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * EnvironmentCore component.
 * @param props A EnvironmentCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentCore = (props: EnvironmentCoreProps) => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// If there are no environment instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronEnvironmentContext.positronEnvironmentInstances.length) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Render.
	return (
		<div className='environment-core'>
			<ActionBars {...props} />
			<div className='environment-instances-container' style={{ width: props.width, height: adjustedHeight }}>
				{positronEnvironmentContext.positronEnvironmentInstances.map(positronEnvironmentInstance =>
					<EnvironmentInstance
						key={positronEnvironmentInstance.runtime.metadata.languageId}
						active={positronEnvironmentInstance === positronEnvironmentContext.activePositronEnvironmentInstance}
						width={props.width}
						height={adjustedHeight}
						positronEnvironmentInstance={positronEnvironmentInstance}
						reactComponentContainer={props.reactComponentContainer} />
				)}
			</div>
		</div>
	);
};
