/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronActionBarServices } from '../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';

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
	positronSessions: Map<string, ILanguageRuntimeSession>;
}

/**
 * The usePositronRuntimeSessionsState custom hook.
 * @returns The hook.
 */
export const usePositronRuntimeSessionsState = (services: PositronSessionsServices): PositronRuntimeSessionsState => {
	// Hooks.
	const [positronSessions, setPositronSessions] =
		useState(
			new Map(services.runtimeSessionService.activeSessions.map(session => [session.sessionId, session])),
		);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidStartPositronSessionsInstance event handler.
		disposableStore.add(services.runtimeSessionService.onDidStartRuntime(session => {
			setPositronSessions(positronSessions => new Map(positronSessions).set(session.sessionId, session));
		}));

		disposableStore.add(services.runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			setPositronSessions(positronSessions => {
				const map = new Map(positronSessions)
				map.delete(sessionId)
				return map;
			});
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [services.runtimeSessionService]);

	// Return the Positron variables state.
	return {
		...services,
		positronSessions: positronSessions
	};
};
