/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dropdownEntry.css';

// React.
import React from 'react';

/**
 * DropdownEntryProps interface.
 */
interface DropdownEntryProps {
	codicon?: string;
	title: string;
	subtitle: string;
	group?: string;
}

/**
 * DropdownEntry component.
 * @param props The dropdown entry props.
 * @returns The rendered component
 */
export const DropdownEntry = (props: DropdownEntryProps) => {
	// Render.
	return (
		<div className='dropdown-entry'>
			{props.codicon ? <div className={`dropdown-entry-icon codicon ${props.codicon}`} /> : null}
			<div className='dropdown-entry-title'>
				{props.title}
			</div>
			<div className='dropdown-entry-subtitle'>
				{props.subtitle}
			</div>
			{props.group ? <div className='dropdown-entry-group'>{props.group}</div> : null}
		</div>
	);
};
