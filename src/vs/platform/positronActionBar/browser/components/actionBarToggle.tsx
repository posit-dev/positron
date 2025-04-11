/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarToggle.css';

// React.
import React, { useRef, useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../base/common/uuid.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';

/**
 * ActionBarToggleProps interface.
 */
interface ActionBarToggleProps {
	toggled?: boolean;
	untoggledLabel: string;
	toggledLabel: string;
	onChanged: (toggled: boolean) => void;
}

/**
 * ActionBarToggle component.
 * @param props An ActionBarToggleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarToggle = (props: ActionBarToggleProps) => {
	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [id] = useState(generateUuid());
	const [toggled, setToggled] = useState(props.toggled ?? false);

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
			<button ref={buttonRef} className='toggle-button' id={id} tabIndex={0} onClick={clickHandler}>
				<div>Left</div>
				<div>Right</div>
			</button>
		</div>
	);
};
