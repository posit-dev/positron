/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './flowFormattedText.css';

// React.
import { PropsWithChildren } from 'react';

/**
 * FlowFormattedTextType enum.
 */
export enum FlowFormattedTextType {
	Info = 'info',
	Warning = 'warning',
	Error = 'error'
}

/**
 * FlowFormattedTextItem interface.
 */
export interface FlowFormattedTextItem {
	type: FlowFormattedTextType;
	text: string;
}

/**
 * FlowFormattedTextProps interface.
 */
export interface FlowFormattedTextProps {
	type: FlowFormattedTextType;
	id?: string;
}

/**
 * FlowFormattedText component.
 * @param props A PropsWithChildren<FlowFormattedTextProps> that contains the component properties.
 * @returns The rendered component.
 */
export const FlowFormattedText = (props: PropsWithChildren<FlowFormattedTextProps>) => {
	// Show an icon in the formatted text if the text type is not Info.
	const iconClass = props.type !== FlowFormattedTextType.Info
		? `codicon codicon-${props.type}`
		: undefined;

	// Render.
	return (
		<div className={`flow-formatted-text flow-formatted-text-${props.type}`} id={props.id}>
			{iconClass && <div className={`flow-formatted-text-icon ${iconClass}`}></div>}
			{props.children}
		</div>
	);
};
