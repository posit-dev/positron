/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dropdownEntry.css';

// Other dependencies.
import { ThemeIcon as ThemeIconType } from '../../../../../base/common/themables.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';

/**
 * DropdownEntryProps interface.
 */
interface DropdownEntryProps {
	icon?: ThemeIconType;
	title: string;
	subtitle: string;
	hoverText?: string;
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
		<div className='dropdown-entry' title={props.hoverText}>
			{props.icon ? <ThemeIcon className='dropdown-entry-icon' icon={props.icon} /> : null}
			<div className='dropdown-entry-title'>
				{props.title}
			</div>
			<div className='dropdown-entry-subtitle'>
				{props.subtitle}
			</div>
			{props.group && <div className='dropdown-entry-group'>{props.group}</div>}
		</div>
	);
};
