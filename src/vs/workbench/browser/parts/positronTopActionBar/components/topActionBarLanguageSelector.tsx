/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarLanguageSelector';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
// import { localize } from 'vs/nls';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showLanguageSelectorModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/languageSelectorModalPopup';
import { DisposableStore } from 'vs/base/common/lifecycle';

/**
 * TopActionBarLanguageSelector component.
 * @returns The rendered component.
 */
export const TopActionBarLanguageSelector = () => {
	// Context hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [activeRuntime, setActiveRuntime] = useState(positronTopActionBarContext.languageRuntimeService.activeRuntime);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		disposableStore.add(
			positronTopActionBarContext.languageRuntimeService.onDidChangeActiveRuntime(runtime => {
				setActiveRuntime(positronTopActionBarContext.languageRuntimeService.activeRuntime);
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * onClick event handler.
	 */
	const clickHandler = () => {
		// Show the language selector modal popup.
		showLanguageSelectorModalPopup(
			positronTopActionBarContext.languageRuntimeService,
			positronTopActionBarContext.layoutService.container,
			ref.current
		);
	};

	if (!activeRuntime) {
		return null;
	}

	// Render.
	return (
		<div ref={ref} className='top-action-bar-language-selector' onClick={clickHandler}>
			<div className='left'>
				<button className='search'>
					<div className='action-bar-button-text'>{activeRuntime.metadata.runtimeName}</div>
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
