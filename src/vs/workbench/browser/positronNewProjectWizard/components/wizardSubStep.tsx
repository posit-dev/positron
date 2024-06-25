/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
	description?: JSX.Element | string;
	descriptionId?: string;
	feedback?: JSX.Element | string;
}

/**
 * PositronWizardSubStep component.
 * @param props A PropsWithChildren<PositronWizardSubStepProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronWizardSubStep = (props: PropsWithChildren<PositronWizardSubStepProps>) => {
	// Render.
	return (
		<div className='wizard-sub-step'>
			{props.title ?
				<div className='wizard-sub-step-title' id={props.titleId}>
					{props.title}
				</div>
				: null
			}
			{props.description ?
				<div className='wizard-sub-step-description' id={props.descriptionId}>
					{props.description}
				</div>
				: null
			}
			<div className='wizard-sub-step-input'>
				{props.children}
			</div>
			{props.feedback ?
				<div className='wizard-sub-step-feedback'>
					{props.feedback}
				</div>
				: null
			}
		</div>
	);
};

