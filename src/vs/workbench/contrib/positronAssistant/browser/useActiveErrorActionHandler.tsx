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
 * The active error action handler, which errors are sent to, kept current as
 * it changes.
 * @returns The handler, or undefined when there is nowhere to send errors.
 */
export function useActiveErrorActionHandler(): IErrorActionHandler | undefined {
	const services = usePositronReactServicesContext();
	const errorActionsService = useMemo(() => services.get(IErrorActionsService), [services]);
	const [handler, setHandler] = useState(() => errorActionsService.activeHandler);

	useEffect(() => {
		setHandler(errorActionsService.activeHandler);
		const disposable = errorActionsService.onDidChangeActiveHandler(setHandler);
		return () => disposable.dispose();
	}, [errorActionsService]);

	return handler;
}
