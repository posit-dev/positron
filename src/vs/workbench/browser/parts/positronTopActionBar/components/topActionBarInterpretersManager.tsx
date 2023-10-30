/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarInterpretersManager';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showInterpretersManagerModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpretersManagerModalPopup';

/**
 * TopActionBarInterpretersManagerProps interface.
 */
interface TopActionBarInterpretersManagerProps {
	onStartRuntime: (runtime: ILanguageRuntime) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntime) => Promise<void>;
}

/**
 * TopActionBarInterpretersManager component.
 * @returns The rendered component.
 */
export const TopActionBarInterpretersManager = (props: TopActionBarInterpretersManagerProps) => {
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

		// Add the onShowStartInterpreterPopup event handler.
		disposableStore.add(
			positronTopActionBarContext.positronTopActionBarService.onShowStartInterpreterPopup(() => {
				showPopup();
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * Shows the interpreters manager modal popup.
	 */
	const showPopup = () => {
		ref.current.setAttribute('aria-expanded', 'true');
		showInterpretersManagerModalPopup(
			positronTopActionBarContext.languageRuntimeService,
			positronTopActionBarContext.layoutService.container,
			ref.current,
			props.onStartRuntime,
			props.onActivateRuntime
		).then(() => {
			ref.current.removeAttribute('aria-expanded');
		});
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

	const label = !activeRuntime ? 'Start Interpreter' : activeRuntime.metadata.runtimeName;

	// Render.
	return (
		<div ref={ref} className='top-action-bar-interpreters-manager' role='button' tabIndex={0} onKeyDown={keyDownHandler} onClick={clickHandler} aria-haspopup='menu' aria-label={label}>
			<div className='left' aria-hidden='true'>
				{!activeRuntime ?
					<div className='label'>{label}</div> :
					<div className='label'>
						<img className='icon' src={`data:image/svg+xml;base64,${activeRuntime.metadata.base64EncodedIconSvg}`} />
						<span>{label}</span>
					</div>
				}
			</div>
			<div className='right' aria-hidden='true'>
				<div className='chevron codicon codicon-chevron-down' />
			</div>
		</div>
	);
};
