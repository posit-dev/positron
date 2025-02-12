/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarCommandCenter.css';

// React.
import React, { MouseEvent } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { AnythingQuickAccessProviderRunOptions } from '../../../../../platform/quickinput/common/quickAccess.js';
import { usePositronTopActionBarContext } from '../positronTopActionBarContext.js';
import { useRegisterWithActionBar } from '../../../../../platform/positronActionBar/browser/useRegisterWithActionBar.js';

/**
 * Localized strings.
 */
const positronShowQuickAccess = localize('positronShowQuickAccess', "Show Quick Access");

/**
 * TopActionBarCommandCenter component.
 * @returns The rendered component.
 */
export const TopActionBarCommandCenter = () => {
	// Hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Ref.
	const searchRef = React.useRef<HTMLButtonElement>(undefined!);
	const dropdownRef = React.useRef<HTMLButtonElement>(undefined!);

	// Participate in roving tabindex.
	useRegisterWithActionBar([searchRef, dropdownRef]);

	// Click handler.
	const clickHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Show the quick access menu.
		positronTopActionBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	// DropDownClick handler.
	const dropDownClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Show the quick access menu.
		positronTopActionBarContext.quickInputService.quickAccess.show('?');
	};

	// Render.
	return (
		<div className='top-action-bar-command-center' onClick={(e) => clickHandler(e)}>
			<div className='left'>
				<div aria-hidden='true' className='codicon codicon-positron-search' />
			</div>
			<div className='center'>
				<button ref={searchRef} className='search' onClick={(e) => clickHandler(e)}>
					<div className='action-bar-button-text'>Search</div>
				</button>
			</div>
			<div className='right'>
				<button ref={dropdownRef} aria-label={positronShowQuickAccess} className='drop-down' onClick={(e) => dropDownClickHandler(e)} >
					<div aria-hidden='true' className='icon codicon codicon-chevron-down' />
				</button>
			</div>
		</div>
	);
};
