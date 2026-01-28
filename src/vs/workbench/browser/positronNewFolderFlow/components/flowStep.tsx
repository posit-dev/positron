/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './flowStep.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { VerticalStack } from '../../positronComponents/positronModalDialog/components/verticalStack.js';
import { OKCancelBackNextActionBar, OKCancelBackNextActionBarProps } from '../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';

/**
 * PositronFlowStepProps interface.
 */
export interface PositronFlowStepProps extends OKCancelBackNextActionBarProps {
	title: string;
}

/**
 * PositronFlowStep component.
 * @param props A PropsWithChildren<PositronFlowStepProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronFlowStep = (props: PropsWithChildren<PositronFlowStepProps>) => {
	// The step ID is based on the title, with non-letter or non-number characters replaced with hyphens.
	const stepId = props.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || '';

	// Render.
	return (
		// QUESTION: should each flow step be a form element?
		<div
			className='flow-step'
			id={stepId.length ? `flow-step-${stepId}` : ''}
		>
			<div className='flow-step-title'>{props.title}</div>
			<VerticalStack>{props.children}</VerticalStack>
			<OKCancelBackNextActionBar
				backButtonConfig={props.backButtonConfig}
				cancelButtonConfig={props.cancelButtonConfig}
				nextButtonConfig={props.nextButtonConfig}
				okButtonConfig={props.okButtonConfig}
			/>
		</div>
	);
};

