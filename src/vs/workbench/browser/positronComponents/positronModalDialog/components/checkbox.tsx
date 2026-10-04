/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkbox.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../../base/common/uuid.js';

/**
 * CheckboxProps interface.
 */
interface CheckboxProps {
	label: string;
	initialChecked?: boolean;
	onChanged: (checked: boolean) => void;
}

// Toggle component.
export const Checkbox = ({ label, initialChecked, onChanged }: CheckboxProps) => {
	// Hooks.
	const [id] = useState(generateUuid());
	const [checked, setChecked] = useState(initialChecked ?? false);

	// Click handler.
	const clickHandler = () => {
		setChecked(!checked);
		onChanged(!checked);
	};


	// Render.
	return (
		<div className='checkbox'>
			<button aria-checked={checked} className='checkbox-button' id={id} role='checkbox' tabIndex={0} type='button' onClick={clickHandler}>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</button>
			<label htmlFor={id}>{label}</label>
		</div>
	);
};
