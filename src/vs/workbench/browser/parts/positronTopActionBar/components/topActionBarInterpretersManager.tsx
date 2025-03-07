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
import { multipleConsoleSessionsFeatureEnabled, USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY } from '../../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';
import { ActionBarCommandButton } from '../../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';

const startInterpreter = localize('positron.startInterpreter', "Start Interpreter");
const startSession = localize('positron.console.startSession', "Start Session");

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
export const TopActionBarInterpretersManager_Legacy = (props: TopActionBarInterpretersManagerProps) => {
	// Context hooks.
	const context = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [activeSession, setActiveSession] =
		useState(context.runtimeSessionService.foregroundSession);

	const label = !activeSession ? startInterpreter : activeSession.metadata.sessionName;

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
				} else if (!session) {
					setActiveSession(undefined);
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

export const TopActionBarInterpretersManager_New = (props: TopActionBarInterpretersManagerProps) => {
	const context = usePositronTopActionBarContext();

	const [activeSession, setActiveSession] = useState<ILanguageRuntimeSession>();

	const labelText = activeSession?.runtimeMetadata?.runtimeName ?? startSession;

	// Check if there are any active console sessions to determine
	// if the active session picker or the create session pikcer
	// should be shown.
	const hasActiveConsoleSessions = context.runtimeSessionService.activeSessions.find(
		session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console);
	const command = hasActiveConsoleSessions
		? 'workbench.action.language.runtime.openActivePicker'
		: 'workbench.action.language.runtime.openStartPicker';

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
				} else if (!session) {
					setActiveSession(undefined);
				}
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [context.runtimeSessionService]);

	return (
		<ActionBarCommandButton
			ariaLabel={CommandCenter.title(command)}
			border={true}
			commandId={command}
			text={labelText}
			{
			...(
				activeSession
					? { iconImageSrc: `data:image/svg+xml;base64,${activeSession?.runtimeMetadata.base64EncodedIconSvg}` }
					: { iconId: 'arrow-swap' }
			)
			}
		/>
	);
}

export const TopActionBarInterpretersManager = (props: TopActionBarInterpretersManagerProps) => {
	const context = usePositronTopActionBarContext();

	const [newInterpretersManager, setNewInterpretersManager] = useState(
		multipleConsoleSessionsFeatureEnabled(context.configurationService)
	);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			context.configurationService.onDidChangeConfiguration((e) => {
				if (e.affectedKeys.has(USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY)) {
					setNewInterpretersManager(
						multipleConsoleSessionsFeatureEnabled(context.configurationService)
					);
				}
			})
		);

		return () => disposableStore.dispose();
	}, [context.configurationService]);

	return (
		newInterpretersManager
			? <TopActionBarInterpretersManager_New {...props} />
			: <TopActionBarInterpretersManager_Legacy {...props} />
	);
}
