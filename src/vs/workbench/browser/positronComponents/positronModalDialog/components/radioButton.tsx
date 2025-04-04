/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import './radioButton.css';

// React.
import React from 'react';

/**
 * RadioButtonItemOptions interface.
 */
interface RadioButtonItemOptions {
	identifier: string;
	title: string;
	disabled?: boolean;
}

/**
 * RadioButtonItem class.
 */
export class RadioButtonItem {
	/**
	 * Constructor.
	 * @param options A RadioButtonItemOptions that contains the radio button item options.
	 */
	constructor(readonly options: RadioButtonItemOptions) { }
}

/**
 * RadioButtonProps interface.
 */
interface RadioButtonProps extends RadioButtonItemOptions {
	selected: boolean;
	groupName: string;
	disabled?: boolean;
	onSelected: () => void;
}

/**
 * RadioButton component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const RadioButton = (props: RadioButtonProps) => {
	// Render.
	return (
		<div className={positronClassNames('radio-button', { disabled: props.disabled })}>
			<input
				checked={props.selected}
				className='radio-button-input'
				disabled={props.disabled}
				id={props.identifier}
				name={props.groupName}
				tabIndex={props.selected ? 0 : -1}
				type='radio'
				value={props.identifier}
				onClick={props.onSelected}
			/>
			<label htmlFor={props.identifier}>{props.title}</label>
		</div>
	);
};
