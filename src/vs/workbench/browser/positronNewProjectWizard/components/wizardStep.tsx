/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./wizardStep';
import * as React from 'react';
import { PropsWithChildren } from 'react';  // eslint-disable-line no-duplicate-imports
import { OKCancelBackNextActionBar, OKCancelBackNextActionBarProps } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelBackNextActionBar';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';

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
				okButtonConfig={props.okButtonConfig}
				cancelButtonConfig={props.cancelButtonConfig}
				backButtonConfig={props.backButtonConfig}
				nextButtonConfig={props.nextButtonConfig}
			/>
		</div>
	);
};

