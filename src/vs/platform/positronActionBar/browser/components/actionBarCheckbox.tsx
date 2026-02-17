/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarCheckbox.css';

// React.
import { forwardRef, PropsWithChildren, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../base/common/uuid.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';

/**
 * ActionBarCheckboxProps interface.
 */
export interface ActionBarCheckboxProps {
	readonly ariaLabel?: string;
	readonly checked?: boolean;
	readonly label?: string;
	readonly tooltip?: string | (() => string | undefined);
	readonly onChanged: (checked: boolean) => void;
}

/**
 * ActionBarCheckbox component.
 * @param props An ActionBarCheckboxProps that contains the component properties.
 * @param ref A ref to the HTMLButtonElement.
 * @returns The rendered component.
 */
export const ActionBarCheckbox = forwardRef<
	HTMLButtonElement,
	PropsWithChildren<ActionBarCheckboxProps>
>((props, ref) => {
	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Imperative handle to ref.
	useImperativeHandle(ref, () => buttonRef.current);

	// State hooks.
	const [id] = useState(generateUuid());
	const [checked, setChecked] = useState(props.checked ?? false);

	// Effect hook to update the checked state when the prop changes.
	useEffect(() => {
		setChecked(props.checked ?? false);
	}, [props.checked]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Click handler.
	const clickHandler = () => {
		buttonRef.current.setAttribute('aria-checked', !checked ? 'true' : 'false');
		setChecked(!checked);
		props.onChanged(!checked);
	};

	// Render.
	return (
		<div className='action-bar-checkbox'>
			<button ref={buttonRef} aria-checked={checked} className='checkbox-button' id={id} role='checkbox' tabIndex={0} onClick={clickHandler}>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</button>
			<label className='checkbox-label' htmlFor={id}>{props.label}</label>
		</div>
	);
});
