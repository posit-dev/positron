/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./wizardFormattedText';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react';  // eslint-disable-line no-duplicate-imports

/**
 * WizardFormattedTextType enum.
 */
export enum WizardFormattedTextType {
	Info = 'info',
	Warning = 'warning',
	Error = 'error'
}

/**
 * WizardFormattedTextItem interface.
 */
export interface WizardFormattedTextItem {
	type: WizardFormattedTextType;
	text: string;
}

/**
 * WizardFormattedTextProps interface.
 */
export interface WizardFormattedTextProps {
	type: WizardFormattedTextType;
	id?: string;
}

/**
 * WizardFormattedText component.
 * @param props A PropsWithChildren<WizardFormattedTextProps> that contains the component properties.
 * @returns The rendered component.
 */
export const WizardFormattedText = (props: PropsWithChildren<WizardFormattedTextProps>) => {
	const iconClass = props.type !== WizardFormattedTextType.Info
		? `codicon codicon-${props.type}`
		: undefined;

	// Render.
	return (
		<div className={`wizard-formatted-text wizard-formatted-text-${props.type}`} id={props.id}>
			{iconClass && <div className={`wizard-formatted-text-icon ${iconClass}`}></div>}
			{props.children}
		</div>
	);
};
