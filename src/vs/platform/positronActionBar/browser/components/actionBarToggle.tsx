/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarToggle.css';

// React.
import { forwardRef, PropsWithChildren, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../base/common/uuid.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * ActionBarToggleProps interface.
 */
interface ActionBarToggleProps {
	readonly ariaLabel?: string;
	readonly leftTitle: string;
	readonly rightTitle: string;
	readonly toggled?: boolean;
	readonly tooltip?: string | (() => string | undefined);
	readonly onChanged: (toggled: boolean) => void;
}

/**
 * ActionBarToggle component.
 * @param props An ActionBarToggleProps that contains the component properties.
 * @param ref A ref to the HTMLButtonElement.
 * @returns The rendered component.
 */
export const ActionBarToggle = forwardRef<
	HTMLButtonElement,
	PropsWithChildren<ActionBarToggleProps>
>((props, ref) => {
	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Imperative handle to ref.
	useImperativeHandle(ref, () => buttonRef.current);

	// State hooks.
	const [id] = useState(generateUuid());
	const [toggled, setToggled] = useState(props.toggled ?? false);

	// Effect hook to update the toggled state when the prop changes.
	useEffect(() => {
		setToggled(props.toggled ?? false);
	}, [props.toggled]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Click handler.
	const clickHandler = () => {
		buttonRef.current.setAttribute('aria-checked', !toggled ? 'true' : 'false');
		setToggled(!toggled);
		props.onChanged(!toggled);
	};

	// Render.
	return (
		<div className='action-bar-toggle'>
			<button ref={buttonRef} aria-checked={toggled} aria-label={props.ariaLabel} className='toggle-container' id={id} tabIndex={0} onClick={clickHandler}>
				<div aria-label={props.leftTitle} className={positronClassNames('toggle-button', 'left', { 'highlighted': !toggled })}>{props.leftTitle}</div>
				<div aria-label={props.rightTitle} className={positronClassNames('toggle-button', 'right', { 'highlighted': toggled })}>{props.rightTitle}</div>
			</button>
		</div>
	);
});
