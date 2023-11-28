/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarCommandCenter';
import * as React from 'react';
import { localize } from 'vs/nls';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';

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
				<div className='codicon codicon-positron-search' aria-hidden='true' />
			</div>
			<div className='center'>
				<button className='search' ref={searchRef} onClick={(e) => clickHandler(e)}>
					<div className='action-bar-button-text'>Search</div>
				</button>
			</div>
			<div className='right'>
				<button className='drop-down' ref={dropdownRef} onClick={(e) => dropDownClickHandler(e)} aria-label={positronShowQuickAccess} >
					<div className='icon codicon codicon-chevron-down' aria-hidden='true' />
				</button>
			</div>
		</div>
	);
};
