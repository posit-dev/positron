/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './wizardStep.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { OKCancelBackNextActionBar, OKCancelBackNextActionBarProps } from '../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';
import { VerticalStack } from '../../positronComponents/positronModalDialog/components/verticalStack.js';

/**
 * PositronWizardModalDialog interface.
 */
export interface PositronWizardStepProps extends OKCancelBackNextActionBarProps {
	title: string;
}

/**
 * OKCancelBackNextModalDialog component.
 * @param props A PropsWithChildren<OKCancelBackNextModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronWizardStep = (props: PropsWithChildren<PositronWizardStepProps>) => {
	// The step ID is based on the title, with non-letter or non-number characters replaced with hyphens.
	const stepId = props.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || '';
	// Render.
	return (
		// QUESTION: should each wizard step be a form element?
		<div
			className='wizard-step'
			id={stepId.length ? `wizard-step-${stepId}` : ''}
		>
			<div className='wizard-step-title'>{props.title}</div>
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

