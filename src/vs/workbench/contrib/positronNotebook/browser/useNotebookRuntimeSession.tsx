/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { isEqual } from '../../../../base/common/resources.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import type { URI } from '../../../../base/common/uri.js';
import { IRuntimeSessionService, type ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * Resolves the current runtime session for a notebook URI and re-renders when
 * a session attaches (via IRuntimeSessionService.onWillStartSession filtered
 * to this URI) or detaches (via the attached session's onDidEndSession).
 *
 * Pairs with useSessionRuntimeState so notebook UI can derive runtime-state
 * display directly from the session, with the runtime session service as
 * the single source of truth.
 */
export function useNotebookRuntimeSession(notebookUri: URI): ILanguageRuntimeSession | undefined {
	const services = usePositronReactServicesContext();
	const runtimeSessionService = services.get(IRuntimeSessionService);

	const [session, setSession] = useState<ILanguageRuntimeSession | undefined>(
		() => runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri)
	);

	useEffect(() => {
		const disposables = new DisposableStore();

		// Sync state in case it changed between render and effect.
		const initial = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		setSession(initial);

		// Listen for new sessions starting for this notebook URI.
		disposables.add(runtimeSessionService.onWillStartSession(({ session: starting }) => {
			if (starting.metadata.notebookUri && isEqual(starting.metadata.notebookUri, notebookUri)) {
				setSession(starting);
			}
		}));

		return () => disposables.dispose();
	}, [runtimeSessionService, notebookUri]);

	// When the resolved session changes, listen for its end to clear it.
	useEffect(() => {
		if (!session) {
			return;
		}
		const disposables = new DisposableStore();
		disposables.add(session.onDidEndSession(() => {
			setSession(prev => (prev === session ? undefined : prev));
		}));
		return () => disposables.dispose();
	}, [session]);

	return session;
}
