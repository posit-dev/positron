/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import type { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Subscribes to a runtime session state and returns its current RuntimeState.
 * Returns undefined when no session is attached so callers can render
 * pre-session fallbacks (e.g., "no kernel selected", "discovering interpreters").
 */
export function useSessionRuntimeState(session: ILanguageRuntimeSession | undefined): RuntimeState | undefined {
	const [runtimeState, setRuntimeState] = useState<RuntimeState | undefined>(() => session?.getRuntimeState());

	useEffect(() => {
		if (!session) {
			setRuntimeState(undefined);
			return;
		}
		const disposables = new DisposableStore();

		// Sync state in case it changed between render and effect.
		setRuntimeState(session.getRuntimeState());
		disposables.add(session.onDidChangeRuntimeState(state => {
			setRuntimeState(state);
		}));

		return () => disposables.dispose();
	}, [session]);

	return runtimeState;
}
