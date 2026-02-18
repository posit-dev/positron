/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DropdownEntryProps interface.
 */
interface DropdownEntryProps {
	title: string;
	subtitle?: string;
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
			<div className='dropdown-entry-title'>
				{props.title}
			</div>
			{props.group ? <div className='dropdown-entry-group'>{props.group}</div> : null}
		</div>
	);
};
