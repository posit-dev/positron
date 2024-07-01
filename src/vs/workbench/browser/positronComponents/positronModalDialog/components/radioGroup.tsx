/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./radioGroup';

// React.
import * as React from 'react';
import { PropsWithChildren, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { RadioButton, RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';

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
			className='radio-group'
			role='radiogroup'
			aria-labelledby={props.labelledBy}
			aria-describedby={props.describedBy}
		>
			{props.entries.map((entry, index) => {
				return (
					<RadioButton
						key={index}
						identifier={entry.options.identifier}
						title={entry.options.title}
						groupName={props.name}
						selected={entry.options.identifier === currentSelection}
						onSelected={() => onSelectionChanged(entry.options.identifier)}
					/>
				);
			})}
		</div>
	);
};
