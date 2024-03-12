/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * PositronSessionsServices interface.
 */
export interface PositronSessionsServices extends PositronActionBarServices {
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronRuntimeSessionsState interface.
 */
export interface PositronRuntimeSessionsState extends PositronSessionsServices {
	positronSessions: ILanguageRuntimeSession[];
}

/**
 * The usePositronRuntimeSessionsState custom hook.
 * @returns The hook.
 */
export const usePositronRuntimeSessionsState = (services: PositronSessionsServices): PositronRuntimeSessionsState => {
	// Hooks.
	const [positronSessions, setPositronSessions] =
		useState<ILanguageRuntimeSession[]>(
			services.runtimeSessionService.activeSessions
		);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidStartPositronSessionsInstance event handler.
		disposableStore.add(services.runtimeSessionService.onDidStartRuntime(session => {
			setPositronSessions(positronSessions => [...positronSessions, session]);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron variables state.
	return {
		...services,
		positronSessions: positronSessions
	};
};
