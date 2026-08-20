/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';

import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { syncAuthSessions } from './languageModelSessionSync.js';

/**
 * Subscribe to the two live provider-update signals for a set of provider ids:
 * `onChangeProviderConfig` (register/update/unregister, incl. signedIn/status)
 * and `syncAuthSessions` (auth session added/removed). Every consumer of the
 * modal needs both, so they live here as the single seam a future backend
 * (e.g. ai-lib) can repoint by swapping this hook's implementation.
 *
 * Callbacks are read through refs so a re-render does not resubscribe.
 *
 * @param providerIds Provider ids to track.
 * @param onConfigChange Called with the updated source on a config change.
 * @param onSignedInChange Called with (providerId, signedIn) on a session change.
 * @param onRegistrationsChange Called when the set of providers to show
 * changes: one is registered or unregistered, or the catalog's enablement
 * moves. Unfiltered, because a provider that has just appeared is by
 * definition not in `providerIds` yet.
 */
export function useProviderUpdates(
	providerIds: string[],
	onConfigChange: (source: IPositronLanguageModelSource) => void,
	onSignedInChange: (providerId: string, signedIn: boolean) => void,
	onRegistrationsChange?: () => void,
): void {
	const services = usePositronReactServicesContext();

	const onConfigChangeRef = useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;
	const onSignedInChangeRef = useRef(onSignedInChange);
	onSignedInChangeRef.current = onSignedInChange;
	const onRegistrationsChangeRef = useRef(onRegistrationsChange);
	onRegistrationsChangeRef.current = onRegistrationsChange;

	// Join into a stable primitive so the effect only resubscribes when the set
	// of tracked ids actually changes, not on every render.
	const idsKey = providerIds.join(',');

	useEffect(() => {
		const configService = services.get(IPositronAssistantConfigurationService);
		const authService = services.get(IAuthenticationService);
		const ids = idsKey ? idsKey.split(',') : [];
		const disposables: IDisposable[] = [];
		disposables.push(configService.onChangeProviderConfig(newSource => {
			if (ids.includes(newSource.provider.id)) {
				onConfigChangeRef.current(newSource);
			}
		}));
		disposables.push(syncAuthSessions(authService, ids, (providerId, signedIn) => {
			onSignedInChangeRef.current(providerId, signedIn);
		}));
		disposables.push(configService.onChangeProviderRegistrations(() => {
			onRegistrationsChangeRef.current?.();
		}));
		// A source is shown only when the catalog says its provider is enabled,
		// and the workbench reads that catalog itself, on its own file watch.
		// For a provider that has just been added, registration arrives first
		// and the enablement that makes it visible lands after, so without this
		// the new row waits for the next time the modal is opened.
		disposables.push(configService.onChangeEnabledProviders(() => {
			onRegistrationsChangeRef.current?.();
		}));
		return () => disposables.forEach(d => d.dispose());
	}, [services, idsKey]);
}
