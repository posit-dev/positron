/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { MAX_RESOURCE_USAGE_HISTORY } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';

/**
 * A hook that tracks the CPU/memory resource usage history for a console
 * instance's session. It loads any persisted history from the resource usage
 * history service and then appends live updates as they arrive from the
 * session, capping the buffer at {@link MAX_RESOURCE_USAGE_HISTORY} points.
 *
 * The history resets whenever the instance changes.
 *
 * @param instance The console instance to track, or undefined for none.
 * @returns The resource usage history, oldest first.
 */
export function useResourceUsageHistory(
	instance: IPositronConsoleInstance | undefined
): ILanguageRuntimeResourceUsage[] {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// State hooks.
	const [resourceUsageHistory, setResourceUsageHistory] = useState<ILanguageRuntimeResourceUsage[]>([]);

	useEffect(() => {
		// Reset history when the tracked instance changes.
		setResourceUsageHistory([]);

		// Nothing to track without an instance.
		if (!instance) {
			return;
		}

		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Track whether we've been cancelled (for async operations).
		let cancelled = false;

		// Adds a resource usage listener to a session that appends incoming data
		// points to the history, keeping only the most recent entries.
		const addResourceUsageListener = (session: ILanguageRuntimeSession): IDisposable => {
			return session.onDidUpdateResourceUsage((usage) => {
				setResourceUsageHistory(prev => {
					const updated = [...prev, usage];
					if (updated.length > MAX_RESOURCE_USAGE_HISTORY) {
						return updated.slice(-MAX_RESOURCE_USAGE_HISTORY);
					}
					return updated;
				});
			});
		};

		// Load historical resource usage data from the service.
		services.resourceUsageHistoryService.getHistory(instance.sessionId).then(history => {
			if (!cancelled && history.length > 0) {
				setResourceUsageHistory(history);
			}
		});

		// Add the resource usage listener to the session if it exists; otherwise
		// wait for the session to start.
		const session = services.runtimeSessionService.getSession(instance.sessionId);
		if (session) {
			disposableStore.add(addResourceUsageListener(session));
		} else {
			disposableStore.add(
				services.runtimeSessionService.onDidStartRuntime(e => {
					if (e.sessionId === instance.sessionId) {
						disposableStore.add(addResourceUsageListener(e));
					}
				})
			);
		}

		// Return cleanup function to dispose of the store when effect cleans up.
		return () => {
			cancelled = true;
			disposableStore.dispose();
		};
	}, [services.resourceUsageHistoryService, services.runtimeSessionService, instance]);

	return resourceUsageHistory;
}
