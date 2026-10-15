/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IErrorActionHandler, IErrorActionsService } from '../common/errorActions.js';

/**
 * The error action handler that errors are sent to, kept current as handlers
 * are registered and unregistered.
 * @returns The handler, or undefined when there is nowhere to send errors.
 */
export function useErrorActionHandler(): IErrorActionHandler | undefined {
	const services = usePositronReactServicesContext();
	const errorActionsService = useMemo(() => services.get(IErrorActionsService), [services]);
	const [handler, setHandler] = useState(() => errorActionsService.getHandler());

	useEffect(() => {
		setHandler(errorActionsService.getHandler());
		const disposable = errorActionsService.onDidChange(() => setHandler(errorActionsService.getHandler()));
		return () => disposable.dispose();
	}, [errorActionsService]);

	return handler;
}
