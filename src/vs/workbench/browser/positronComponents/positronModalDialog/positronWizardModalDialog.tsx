/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren } from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKCancelBackNextActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelBackNextActionBar';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';

/**
 * PositronWizardModalDialog interface.
 */
export interface PositronWizardModalDialogProps extends PositronModalDialogProps {
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
export const PositronWizardModalDialog = (props: PropsWithChildren<PositronWizardModalDialogProps>) => {
	// Render.
	return (
		<PositronModalDialog {...props}>
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKCancelBackNextActionBar
				// Hide ok button except on final step
				hideOkButton={props.currentStep !== props.totalSteps - 1}
				// Hide back button when on first step
				hideBackButton={props.currentStep === 0}
				// Hide next button when on final step
				hideNextButton={props.currentStep === props.totalSteps - 1}
				{...props}
			/>
		</PositronModalDialog>
	);
};

