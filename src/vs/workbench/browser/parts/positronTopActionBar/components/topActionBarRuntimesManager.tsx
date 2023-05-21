/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarRuntimesManager';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showRuntimesManagerModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/runtimesManagerModalPopup';

/**
 * TopActionBarRuntimesManager component.
 * @returns The rendered component.
 */
export const TopActionBarRuntimesManager = () => {
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

		// Add the onDidChangeActiveRuntime event handler.
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
		showRuntimesManagerModalPopup(
			positronTopActionBarContext.languageRuntimeService,
			positronTopActionBarContext.layoutService.container,
			ref.current
		);
	};

	if (!activeRuntime) {
		console.log('+++++++++++++++++++++++++++++++++++++++++ activeRuntime is undefined. Rendering nothing.');
		return null;
	}

	// Render.
	return (
		<div ref={ref} className='top-action-bar-runtimes-manager' onClick={clickHandler}>
			<div className='left'>
				<button className='search'>
					<div className='action-bar-button-text'>{activeRuntime.metadata.languageName} {activeRuntime.metadata.languageVersion}</div>
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
