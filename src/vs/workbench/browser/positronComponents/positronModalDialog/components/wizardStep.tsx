/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./wizardStep';
const React = require('react');
import { PropsWithChildren } from 'react';
import { OKCancelBackNextActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelBackNextActionBar';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';

/**
 * PositronWizardModalDialog interface.
 */
export interface PositronWizardStepProps {
	title: string;
	currentStep: number;
	totalSteps: number;
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	backButtonTitle?: string;
	nextButtonTitle?: string;
	accept: () => void;
	cancel: () => void;
	back: () => void;
	next: () => void;
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
				okButtonConfig={{
					title: props.okButtonTitle,
					// Hide ok button except on final step
					hide: props.currentStep !== props.totalSteps - 1,
					disable: false,
					onClick: props.accept
				}}
				cancelButtonConfig={{
					title: props.cancelButtonTitle,
					// Show cancel button on all steps
					hide: false,
					disable: false,
					onClick: props.cancel
				}}
				backButtonConfig={{
					title: props.backButtonTitle,
					// Hide back button when on first step
					hide: props.currentStep === 0,
					disable: false,
					onClick: props.back
				}}
				nextButtonConfig={{
					title: props.nextButtonTitle,
					// Hide next button when on final step
					hide: props.currentStep === props.totalSteps - 1,
					disable: false,
					onClick: props.next
				}}
			/>
		</div>
	);
};

