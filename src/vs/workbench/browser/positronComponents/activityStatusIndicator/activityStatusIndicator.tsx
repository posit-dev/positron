/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityStatusIndicator.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Event } from '../../../../base/common/event.js';

/**
 * The status of a backend shown by the indicator.
 */
export type ActivityStatus = 'idle' | 'computing' | 'disconnected' | 'error';

/**
 * How long a status must hold before the indicator shows it, except when leaving idle.
 */
const DEBOUNCE_MS = 250;

/**
 * ActivityStatusIndicatorProps interface.
 */
interface ActivityStatusIndicatorProps {
	readonly status: ActivityStatus;
	readonly onDidChangeStatus: Event<ActivityStatus>;
}

/**
 * ActivityStatusIndicator component. Shows whether a backend is idle, computing, or disconnected.
 * Leaving idle shows immediately; every other change is debounced so brief requests don't flicker.
 */
export const ActivityStatusIndicator = ({ status: initialStatus, onDidChangeStatus }: ActivityStatusIndicatorProps) => {
	const [status, setStatus] = useState<ActivityStatus>(initialStatus);
	const statusRef = useRef(status);
	statusRef.current = status;

	useEffect(() => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const disposable = onDidChangeStatus(newStatus => {
			clearTimeout(timeout);
			timeout = undefined;
			if (statusRef.current === 'idle' && newStatus !== 'idle') {
				setStatus(newStatus);
			} else {
				timeout = setTimeout(() => setStatus(newStatus), DEBOUNCE_MS);
			}
		});
		return () => {
			clearTimeout(timeout);
			disposable.dispose();
		};
	}, [onDidChangeStatus]);

	const statusText = (() => {
		switch (status) {
			case 'idle':
				return localize('positron.activityStatus.idle', "Idle");
			case 'computing':
				return localize('positron.activityStatus.computing', "Computing");
			case 'disconnected':
				return localize('positron.activityStatus.disconnected', "Disconnected");
			case 'error':
				return localize('positron.activityStatus.error', "Error");
		}
	})();

	return (
		<div className='positron-activity-status-indicator status-bar-indicator'>
			<div aria-label={statusText} className={`icon ${status}`} title={statusText} />
		</div>
	);
};
