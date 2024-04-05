/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./wizardSubStep';
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
	feedback?: string;
	feedbackId?: string;
}

/**
 * OKCancelBackNextModalDialog component.
 * @param props A PropsWithChildren<OKCancelBackNextModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronWizardSubStep = (props: PropsWithChildren<PositronWizardSubStepProps>) => {
	// TODO: on focus change outside of the input element, perform validation of input
	//       if input is invalid, notify wizardstep parent to disable the next/confirm buttons
	//       in input is valid , notify wizardstep parent to enable the next/confirm buttons

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
			{props.feedback ?
				<div className='wizard-sub-step-feedback' id={props.feedbackId}>
					{props.feedback}
				</div> : null
			}
		</div>
	);
};

