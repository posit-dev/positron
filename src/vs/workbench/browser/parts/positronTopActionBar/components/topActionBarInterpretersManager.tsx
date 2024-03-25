/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./topActionBarInterpretersManager';

// React.
import * as React from 'react';
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { InterpretersManagerModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpretersManagerModalPopup';

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
				renderer={renderer}
				anchor={ref.current}
			/>
		);
	}, [context, props]);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidStartRuntime event handler.
		disposableStore.add(
			context.runtimeSessionService.onDidStartRuntime(session => {
				if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
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
			className='top-action-bar-interpreters-manager'
			role='button'
			tabIndex={0}
			onKeyDown={keyDownHandler}
			onClick={clickHandler}
			aria-haspopup='menu' aria-label={label}
		>
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
