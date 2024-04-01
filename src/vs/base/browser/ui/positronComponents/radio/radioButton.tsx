/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./radioButton';

// React.
import React = require('react');

/**
 * RadioButtonItemOptions interface.
 */
export interface RadioButtonItemOptions {
	identifier: string;
	title: string;
	icon?: string;
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
export interface RadioButtonProps extends RadioButtonItemOptions {
	isFirstButtonInGroup?: boolean;
	selected: boolean;
	onSelected: () => void;
}

export const RadioButton = (props: RadioButtonProps) => {
	// Render.
	return (
		// May not need tabIndex
		<div className='radio-button'>
			{/* // TODO: is aria-checked needed? any other aria attributes? */}
			{/* This is the basic radio button display */}
			<input
				type='radio'
				tabIndex={props.isFirstButtonInGroup ? 0 : -1}
				id={props.identifier}
				name={props.title}
				value={props.identifier}
				checked={props.selected}
				onClick={props.onSelected}
			/>
			<label htmlFor={props.identifier}>{props.title}</label>
			{/* TODO: if an icon is provided, display the radio button differently */}
		</div>
	);
};
