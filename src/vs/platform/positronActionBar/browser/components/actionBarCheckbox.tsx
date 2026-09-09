/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarCheckbox.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../base/common/uuid.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * ActionBarCheckboxProps interface.
 */
export interface ActionBarCheckboxProps {
	readonly ariaLabel?: string;
	readonly checked?: boolean;
	readonly label?: string;
	readonly tooltip?: string | (() => string | undefined);
	readonly onChanged: (checked: boolean) => void;
	ref?: React.Ref<HTMLButtonElement>;
}

/**
 * ActionBarCheckbox component.
 *
 * This is a `role='checkbox'` button rather than an `<input type='checkbox'>`, which is also what
 * core's own checkbox is (see Toggle in `base/browser/ui/toggle/toggle.ts`). Button supplies the
 * action bar's hover manager for tooltips, activates once per Space or Enter press rather than
 * twice, and consumes mousedown so pressing the control does not move focus.
 *
 * The checkbox flips its own state on click and then reports the new value, which is what it has
 * always done. The displayed state can therefore disagree with the command until the next render.
 * Correcting that means reading the command's state instead, which is a separate change.
 *
 * @param props An ActionBarCheckboxProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarCheckbox = (props: ActionBarCheckboxProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// State hooks.
	const [id] = useState(() => generateUuid());
	const [checked, setChecked] = useState(props.checked ?? false);

	// Effect hook to update the checked state when the prop changes.
	useEffect(() => {
		setChecked(props.checked ?? false);
	}, [props.checked]);

	// Render.
	return (
		<div className='action-bar-checkbox'>
			<Button
				ref={props.ref}
				ariaChecked={checked}
				className='checkbox-button'
				hoverManager={context.hoverManager}
				id={id}
				role='checkbox'
				tooltip={props.tooltip}
				onPressed={() => {
					setChecked(!checked);
					props.onChanged(!checked);
				}}
			>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</Button>
			<label className='checkbox-label' htmlFor={id}>{props.label}</label>
		</div>
	);
};
