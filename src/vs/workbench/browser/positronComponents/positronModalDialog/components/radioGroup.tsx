/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './radioGroup.css';

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { RadioButton, RadioButtonItem } from './radioButton.js';

/**
 * RadioGroupProps interface.
 */
interface RadioGroupProps {
	name: string;
	entries: RadioButtonItem[];
	initialSelectionId?: string;
	labelledBy?: string;
	describedBy?: string;
	onSelectionChanged: (identifier: string) => void;
}

/**
 * RadioGroup component.
 * @param props The component properties.
 * @returns The rendered component.
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/radio/ for accessibility guidelines.
 */
export const RadioGroup = (props: PropsWithChildren<RadioGroupProps>) => {
	// Hooks.
	const [currentSelection, setCurrentSelection] = useState(props.initialSelectionId);

	// On radio button selected, update the current selection and notify the parent.
	const onSelectionChanged = (identifier: string) => {
		setCurrentSelection(identifier);
		props.onSelectionChanged(identifier);
	};

	// Render.
	return (
		<div
			aria-describedby={props.describedBy}
			aria-labelledby={props.labelledBy}
			className='radio-group'
			role='radiogroup'
		>
			{props.entries.map((entry, index) => {
				return (
					<RadioButton
						key={index}
						disabled={entry.options.disabled}
						groupName={props.name}
						identifier={entry.options.identifier}
						selected={entry.options.identifier === currentSelection}
						title={entry.options.title}
						onSelected={() => onSelectionChanged(entry.options.identifier)}
					/>
				);
			})}
		</div>
	);
};
