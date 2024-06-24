/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./radioButton';

// React.
import React = require('react');

/**
 * RadioButtonItemOptions interface.
 */
interface RadioButtonItemOptions {
	identifier: string;
	title: string;
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
		<div className='radio-button'>
			<input
				className='radio-button-input'
				type='radio'
				tabIndex={props.selected ? 0 : -1}
				id={props.identifier}
				name={props.groupName}
				value={props.identifier}
				checked={props.selected}
				onClick={props.onSelected}
			/>
			<label htmlFor={props.identifier}>{props.title}</label>
		</div>
	);
};
