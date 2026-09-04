/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarCheckbox.css';

// React.
import React from 'react';

// Other dependencies.
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';

/**
 * ActionBarCheckboxProps interface.
 */
export interface ActionBarCheckboxProps {
	readonly ariaLabel?: string;
	readonly checked: boolean;
	/** Marks the checkbox unavailable using native button disabled semantics. */
	readonly disabled?: boolean;
	readonly label?: string;
	readonly tooltip?: string | (() => string | undefined);
	readonly onChanged: (checked: boolean) => void;
	ref?: React.Ref<HTMLButtonElement>;
}

/**
 * ActionBarCheckbox component.
 *
 * This is a `role='checkbox'` button rather than an `<input type='checkbox'>`, which is also what
 * core's own checkbox is (see Toggle in `base/browser/ui/toggle/toggle.ts`). It follows the native
 * button disabled behavior used by Positron's other action-bar controls. Button also supplies the
 * action bar's hover manager for tooltips. Activating on Enter as well as Space follows from
 * Button, and matches what core's Toggle accepts.
 *
 * Wrapping core's Toggle instead would mean owning an imperative DOM widget's lifecycle from
 * React, and it brings its own codicon and title handling to fight with the action bar's.
 *
 * @param props An ActionBarCheckboxProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarCheckbox = (props: ActionBarCheckboxProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Render. The face is hidden from assistive technology and the control is named by ariaLabel,
	// because VoiceOver reads a button with inner text as a group rather than as a single control.
	return (
		<div className='action-bar-checkbox'>
			<Button
				ref={props.ref}
				ariaChecked={props.checked}
				ariaLabel={props.ariaLabel ?? props.label}
				className='checkbox-button'
				disabled={props.disabled}
				hoverManager={context.hoverManager}
				role='checkbox'
				tooltip={props.tooltip}
				onPressed={() => props.onChanged(!props.checked)}
			>
				<div aria-hidden='true' className='checkbox-face'>
					<div className='checkbox-indicator'>
						{props.checked && <div className='codicon codicon-check' />}
					</div>
					{props.label && <div className='checkbox-label'>{props.label}</div>}
				</div>
			</Button>
		</div>
	);
};
