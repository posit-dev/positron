/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkbox.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../common/uuid.js';

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

	// Change handler.
	const changeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
		setChecked(e.target.checked);
		onChanged(e.target.checked);
	};

	// Render.
	return (
		<div className='checkbox'>
			<input checked={checked} className='checkbox-input' id={id} type='checkbox' onChange={changeHandler} />
			<label htmlFor={id}>{label}</label>
		</div>
	);
};
