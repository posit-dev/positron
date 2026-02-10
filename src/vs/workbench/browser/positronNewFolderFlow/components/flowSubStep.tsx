/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './flowSubStep.css';

// React.
import { JSX, PropsWithChildren } from 'react';

/**
 * PositronFlowSubStepProps interface.
 */
export interface PositronFlowSubStepProps {
	title?: string;
	titleId?: string;
	description?: JSX.Element | string;
	descriptionId?: string;
	feedback?: JSX.Element | string;
}

/**
 * PositronFlowSubStep component.
 * @param props A PropsWithChildren<PositronFlowSubStepProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronFlowSubStep = (props: PropsWithChildren<PositronFlowSubStepProps>) => {
	// The sub step ID is based on the title, with non-letter or non-number characters replaced with hyphens.
	// Try using the titleId before the title, which may be shorter.
	const subStepTitleId = props.titleId || props.title;
	const subStepId = subStepTitleId?.toLowerCase().replace(/[^a-z0-9]/g, '-') || '';

	// Render.
	return (
		<div className='flow-sub-step' id={subStepId.length ? `flow-sub-step-${subStepId}` : ''}>
			{props.title &&
				<div className='flow-sub-step-title' id={props.titleId}>
					{props.title}
				</div>
			}
			{props.description &&
				<div className='flow-sub-step-description' id={props.descriptionId}>
					{props.description}
				</div>
			}
			<div className='flow-sub-step-input'>
				{props.children}
			</div>
			{props.feedback &&
				<div className='flow-sub-step-feedback'>
					{props.feedback}
				</div>
			}
		</div>
	);
};

