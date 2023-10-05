/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarCustomFolderMenu';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showCustomFolderPopup } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderModalPopup';

/**
 * TopActionBarCustonFolderMenuProps interface.
 */
interface TopActionBarCustonFolderMenuProps {
}

/**
 * TopActionBarCustonFolderMenu component.
 * @returns The rendered component.
 */
export const TopActionBarCustonFolderMenu = (props: TopActionBarCustonFolderMenuProps) => {
	// Context hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	// const [activeRuntime, setActiveRuntime] = useState(positronTopActionBarContext.languageRuntimeService.activeRuntime);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// // Add the onDidChangeActiveRuntime event handler.
		// disposableStore.add(
		// 	positronTopActionBarContext.languageRuntimeService.onDidChangeActiveRuntime(runtime => {
		// 		setActiveRuntime(positronTopActionBarContext.languageRuntimeService.activeRuntime);
		// 	})
		// );

		// // Add the onShowStartInterpreterPopup event handler.
		// disposableStore.add(
		// 	positronTopActionBarContext.positronTopActionBarService.onShowStartInterpreterPopup(() => {
		// 		showPopup();
		// 	})
		// );

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * Shows the runtimes manager modal popup.
	 */
	const showPopup = () => {
		showCustomFolderPopup(
			positronTopActionBarContext.labelService,
			positronTopActionBarContext.workspacesService,
			positronTopActionBarContext.layoutService.container,
			ref.current
		);
		// // Show the runtimes manager modal popup.
		// showCustonFolderMenuModalPopup(
		// 	positronTopActionBarContext.languageRuntimeService,
		// 	positronTopActionBarContext.layoutService.container,
		// 	ref.current,
		// 	props.onStartRuntime,
		// 	props.onActivateRuntime
		// );
	};

	/**
	 * onKeyDown event handler.
	 */
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		switch (e.code) {
			case 'Space':
			case 'Enter':
				showPopup();
				break;
		}
	};

	/**
	 * onClick event handler.
	 */
	const clickHandler = () => {
		showPopup();
	};

	// Render.
	return (
		<div ref={ref} className='top-action-bar-custom-folder-menu' role='button' tabIndex={0} onKeyDown={keyDownHandler} onClick={clickHandler}>
			<div className='left'>
				<div className='label'>
					<div className={'action-bar-button-icon codicon codicon-folder'} />
					{positronTopActionBarContext.workspaceFolder &&
						<div className='label'>{positronTopActionBarContext.workspaceFolder ? positronTopActionBarContext.workspaceFolder.name : ''}</div>
					}

				</div>
			</div>
			<div className='right'>
				<div className='chevron codicon codicon-chevron-down' />
			</div>
		</div>
	);
};
