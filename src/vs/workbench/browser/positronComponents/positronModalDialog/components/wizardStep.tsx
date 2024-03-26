/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	// Render.
	return (
		// QUESTION: should each wizard step be a form element?
		<div className='wizard-step'>
			<div className='wizard-step-title'>
				{props.title}
			</div>
			<VerticalStack>
				{/*
					TODO: based on input validation in children, handle errors/incomplete input
					by displaying corresponding help text and disable the next/create buttons
				*/}
				{props.children}
			</VerticalStack>
			<OKCancelBackNextActionBar
				okButtonConfig={props.okButtonConfig}
				cancelButtonConfig={props.cancelButtonConfig}
				backButtonConfig={props.backButtonConfig}
				nextButtonConfig={props.nextButtonConfig}
			/>
		</div>
	);
};

