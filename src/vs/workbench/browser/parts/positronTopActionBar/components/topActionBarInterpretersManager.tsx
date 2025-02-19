/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarInterpretersManager.css';

// React.
import React, { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { useRegisterWithActionBar } from '../../../../../platform/positronActionBar/browser/useRegisterWithActionBar.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { usePositronTopActionBarContext } from '../positronTopActionBarContext.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { InterpretersManagerModalPopup } from '../interpretersManagerModalPopup/interpretersManagerModalPopup.js';

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
	const context = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [activeSession, setActiveSession] =
		useState(context.runtimeSessionService.foregroundSession);

	/**
	 * Shows the interpreters manager modal popup.
	 */
	const showPopup = useCallback(() => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current,
		});

		// Show the interpreters manager modal popup.
		renderer.render(
			<InterpretersManagerModalPopup
				{...context}
				{...props}
				anchorElement={ref.current}
				renderer={renderer}
			/>
		);
	}, [context, props]);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeForegroundSession event handler.
		disposableStore.add(
			context.runtimeSessionService.onDidChangeForegroundSession(session => {
				if (session?.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
					setActiveSession(
						context.runtimeSessionService.foregroundSession);
				}
			})
		);

		// Add the onShowStartInterpreterPopup event handler.
		disposableStore.add(
			context.positronTopActionBarService.onShowStartInterpreterPopup(() => {
				showPopup();
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [context.positronTopActionBarService, context.runtimeSessionService, showPopup]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([ref]);

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
		<div
			ref={ref}
			aria-haspopup='menu'
			aria-label={label}
			className='top-action-bar-interpreters-manager'
			role='button'
			tabIndex={0}
			onClick={clickHandler} onKeyDown={keyDownHandler}
		>
			<div aria-hidden='true' className='left'>
				{!activeSession ?
					<div className='label'>{label}</div> :
					<div className='label'>
						<img className='icon' src={`data:image/svg+xml;base64,${activeSession.runtimeMetadata.base64EncodedIconSvg}`} />
						<span>{label}</span>
					</div>
				}
			</div>
			<div aria-hidden='true' className='right'>
				<div className='chevron codicon codicon-chevron-down' />
			</div>
		</div>
	);
};
