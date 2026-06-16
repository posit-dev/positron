/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import type { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Returns the current RuntimeState for a session, for rendering status indicators.
 * Restart is special-cased: the state stays `Restarting` for the whole restart so a
 * transient `idle` mid-restart isn't surfaced. Returns undefined when no session is attached.
 */
export function useSessionRuntimeState(session: ILanguageRuntimeSession | undefined): RuntimeState | undefined {
	const services = usePositronReactServicesContext();
	const [runtimeState, setRuntimeState] = useState<RuntimeState | undefined>(() =>
		session
			? services.runtimeSessionService.getDisplayRuntimeState(session.sessionId) ?? session.getRuntimeState()
			: undefined
	);

	useEffect(() => {
		if (!session) {
			setRuntimeState(undefined);
			return;
		}
		const disposables = new DisposableStore();
		setRuntimeState(
			services.runtimeSessionService.getDisplayRuntimeState(session.sessionId) ?? session.getRuntimeState()
		);
		disposables.add(services.runtimeSessionService.onDidChangeDisplayRuntimeState(e => {
			if (e.sessionId === session.sessionId) {
				setRuntimeState(e.state);
			}
		}));
		return () => disposables.dispose();
	}, [session, services]);

	return runtimeState;
}
