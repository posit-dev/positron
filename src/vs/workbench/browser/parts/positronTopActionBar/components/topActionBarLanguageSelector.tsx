/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarLanguageSelector';
import * as React from 'react';
// import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

/**
 * TopActionBarLanguageSelector component.
 * @returns The rendered component.
 */
export const TopActionBarLanguageSelector = () => {
	// Hooks.
	// const positronTopActionBarContext = usePositronTopActionBarContext();

	// Render.
	return (
		<div className='top-action-bar-language-selector'>
			<div className='left'>
				<button className='search'>
					<div className='action-bar-button-text'>Python</div>
				</button>
			</div>
			<div className='right'>
				<button className='drop-down'>
					<div className='chevron codicon codicon-positron-chevron-down' />
				</button>
			</div>
		</div>
	);
};
