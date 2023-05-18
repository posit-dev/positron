/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarLanguageSelector';
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showLanguageSelectorModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/languageSelectorModalPopup';

/**
 * TopActionBarLanguageSelector component.
 * @returns The rendered component.
 */
export const TopActionBarLanguageSelector = () => {
	// Context hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	/**
	 * onClick event handler.
	 */
	const clickHandler = () => {
		showLanguageSelectorModalPopup(positronTopActionBarContext.layoutService, ref.current);
	};

	// Render.
	return (
		<div ref={ref} className='top-action-bar-language-selector' onClick={clickHandler}>
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
