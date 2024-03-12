/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarInterpretersManager';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { showInterpretersManagerModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpretersManagerModalPopup';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * TopActionBarInterpretersManagerProps interface.
 */
interface TopActionBarInterpretersManagerProps {
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
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
	const [activeSession, setActiveSession] =
		useState(positronTopActionBarContext.runtimeSessionService.foregroundSession);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidStartRuntime event handler.
		disposableStore.add(
			positronTopActionBarContext.runtimeSessionService.onDidStartRuntime(session => {
				if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
					setActiveSession(
						positronTopActionBarContext.runtimeSessionService.foregroundSession);
				}
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

	// Participate in roving tabindex.
	useRegisterWithActionBar([ref]);

	/**
	 * Shows the interpreters manager modal popup.
	 */
	const showPopup = () => {
		ref.current.setAttribute('aria-expanded', 'true');
		showInterpretersManagerModalPopup(
			positronTopActionBarContext.languageRuntimeService,
			positronTopActionBarContext.runtimeStartupService,
			positronTopActionBarContext.runtimeSessionService,
			positronTopActionBarContext.layoutService.mainContainer,
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

	const label = !activeSession ? 'Start Interpreter' : activeSession.metadata.sessionName;

	// Render.
	return (
		<div ref={ref} className='top-action-bar-interpreters-manager' role='button' tabIndex={0} onKeyDown={keyDownHandler} onClick={clickHandler} aria-haspopup='menu' aria-label={label}>
			<div className='left' aria-hidden='true'>
				{!activeSession ?
					<div className='label'>{label}</div> :
					<div className='label'>
						<img className='icon' src={`data:image/svg+xml;base64,${activeSession.runtimeMetadata.base64EncodedIconSvg}`} />
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
