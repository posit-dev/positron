/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroup';
import * as React from 'react';
import { KeyboardEvent, MouseEvent, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PrimaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/primaryInterpreter';
import { ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IInterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterGroups';
import { SecondaryInterpreter } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/secondaryInterpreter';

/**
 * InterpreterGroupProps interface.
 */
interface InterpreterGroupProps {
	languageRuntimeService: ILanguageRuntimeService;
	interpreterGroup: IInterpreterGroup;
	dismiss: () => void;
}

/**
 * InterpreterGroup component.
 * @param props A InterpreterGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterGroup = (props: InterpreterGroupProps) => {
	/**
	 * Determines whether an alternate runtime is alive.
	 * @returns A value which indicates whether an alternate runtime is alive.
	 */
	const isAlternateRuntimeAlive = () => {
		// If any of the alternate runtimes are alive, return true.
		for (const runtime of props.interpreterGroup.alternateRuntimes) {
			const runtimeState = runtime.getRuntimeState();
			switch (runtimeState) {
				case RuntimeState.Initializing:
				case RuntimeState.Starting:
				case RuntimeState.Ready:
				case RuntimeState.Idle:
				case RuntimeState.Busy:
				case RuntimeState.Exiting:
				case RuntimeState.Offline:
				case RuntimeState.Interrupting:
					return true;
			}
		}

		// An alternate runtime is not alive.
		return false;
	};

	// State hooks.
	const [alternateRuntimeAlive, setAlternateRuntimeAlive] = useState(isAlternateRuntimeAlive());
	const [showAllVersions, setShowAllVersions] = useState(isAlternateRuntimeAlive());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler for the primary runtime.
		disposableStore.add(
			props.interpreterGroup.primaryRuntime.onDidChangeRuntimeState(runtimeState => {
				const alternateRuntimeAlive = isAlternateRuntimeAlive();
				setAlternateRuntimeAlive(alternateRuntimeAlive);
				if (alternateRuntimeAlive) {
					setShowAllVersions(true);
				}
			})
		);

		// Add the onDidChangeRuntimeState event handler for the alternate runtimes.
		for (const runtime of props.interpreterGroup.alternateRuntimes) {
			disposableStore.add(runtime.onDidChangeRuntimeState(runtimeState => {
				const alternateRuntimeAlive = isAlternateRuntimeAlive();
				setAlternateRuntimeAlive(alternateRuntimeAlive);
				if (alternateRuntimeAlive) {
					setShowAllVersions(true);
				}
			}));
		}

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * runtimeKey event handler.
	 */
	const runtimeKeyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		switch (e.code) {
			case 'Space':
			case 'Enter':
				e.preventDefault();
				e.stopPropagation();
				props.languageRuntimeService.activeRuntime = props.interpreterGroup.primaryRuntime;
				props.dismiss();
				break;
		}
	};

	/**
	 * runtimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const runtimeClickHandler = (e: MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.languageRuntimeService.activeRuntime = props.interpreterGroup.primaryRuntime;
		props.dismiss();
	};

	const showAllVersionsHandler = () => {
		setShowAllVersions(!showAllVersions);
	};

	// Render.
	return (
		<div className='interpreter-group' role='button' tabIndex={0} onKeyDown={runtimeKeyDownHandler} onClick={runtimeClickHandler}>
			<PrimaryInterpreter
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.interpreterGroup.primaryRuntime}
				primaryRuntime={true}
				enableShowAllVersions={!alternateRuntimeAlive}
				showAllVersions={showAllVersionsHandler}
				dismiss={props.dismiss}
			/>
			{(alternateRuntimeAlive || showAllVersions) && props.interpreterGroup.alternateRuntimes.map(runtime =>
				<SecondaryInterpreter languageRuntimeService={props.languageRuntimeService} runtime={runtime} dismiss={props.dismiss} />
			)}
		</div>
	);
};
