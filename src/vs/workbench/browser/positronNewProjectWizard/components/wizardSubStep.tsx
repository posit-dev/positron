/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./wizardSubStep';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react';  // eslint-disable-line no-duplicate-imports

/**
 * PositronWizardModalDialog interface.
 */
export interface PositronWizardSubStepProps {
	title?: string;
	titleId?: string;
	description?: string;
	descriptionId?: string;
	feedback?: () => JSX.Element;
}

/**
 * PositronWizardSubStep component.
 * @param props A PropsWithChildren<PositronWizardSubStepProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronWizardSubStep = (props: PropsWithChildren<PositronWizardSubStepProps>) => {
	// TODO: on focus change outside of the input element, perform validation of input
	//       if input is invalid, notify wizardstep parent to disable the next/confirm buttons
	//       in input is valid , notify wizardstep parent to enable the next/confirm buttons
	const Feedback = () => props.feedback ? props.feedback() : null;
	// Render.
	return (
		<div className='wizard-sub-step'>
			{props.title ?
				<div className='wizard-sub-step-title' id={props.titleId}>
					{props.title}
				</div> : null
			}
			{props.description ?
				<div className='wizard-sub-step-description' id={props.descriptionId}>
					{props.description}
				</div> : null
			}
			<div className='wizard-sub-step-input'>
				{props.children}
			</div>
			<div className='wizard-sub-step-feedback'>
				{props.feedback ? <Feedback /> : null}
			</div>
		</div>
	);
};

