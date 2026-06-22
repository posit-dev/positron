/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from 'react';
import { Event } from '../../../../../base/common/event.js';
import { useEventState } from '../../../../../base/browser/ui/react/useEventState.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import type { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Returns the current display friendly RuntimeState for a session.
 * Restart is special-cased: the state stays `Restarting` for the
 * whole restart so a transient `idle` mid-restart isn't surfaced.
 * Returns undefined when no session is attached.
 */
export function useSessionRuntimeState(session: ILanguageRuntimeSession | undefined): RuntimeState | undefined {
	const services = usePositronReactServicesContext();

	// Create a new memoized event that filters out state change events for
	// other sessions, so we only re-render when our session's state changes.
	// This avoids unnecessary re-renders when this event fires for other sessions.
	const onDidChangeDisplayRuntimeStateEventForSession = useMemo(
		() => session
			? Event.map(
				Event.filter(
					services.runtimeSessionService.onDidChangeDisplayRuntimeState,
					e => e.sessionId === session.sessionId
				),
				e => e.state
			)
			: undefined,
		[services.runtimeSessionService, session]
	);

	// Listen to this event and return the new state whenever it fires. If no session, return undefined.
	return useEventState(
		onDidChangeDisplayRuntimeStateEventForSession,
		() => session
			? services.runtimeSessionService.getDisplayRuntimeState(session.sessionId) ?? session.getRuntimeState()
			: undefined,
	);
}
