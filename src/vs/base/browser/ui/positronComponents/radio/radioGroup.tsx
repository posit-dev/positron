/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./radioGroup';

// React.
import * as React from 'react';
import { PropsWithChildren, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { RadioButton, RadioButtonItem } from 'vs/base/browser/ui/positronComponents/radio/radioButton';

/**
 * RadioGroupProps interface.
 */
interface RadioGroupProps {
	entries: RadioButtonItem[];
	initialSelectionId?: string;
	labelledBy?: string;
	describedBy?: string;
	onSelectionChanged: (identifier: string) => void;
}

// Reading: https://www.w3.org/WAI/ARIA/apg/patterns/radio/

/**
 * RadioGroup component.
 * @param props The component properties.
 * @returns The rendered component.
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
		<div className='radio-group' role='radiogroup' aria-labelledby={props.labelledBy} aria-describedby={props.describedBy}>
			{props.entries.map((entry, index) => {
				return (
					<RadioButton
						isFirstButtonInGroup={index === 0}
						key={index}
						identifier={entry.options.identifier}
						title={entry.options.title}
						icon={entry.options.icon}
						selected={entry.options.identifier === currentSelection}
						onSelected={() => onSelectionChanged(entry.options.identifier)}
					/>
				);
			})}
		</div>
	);
};

