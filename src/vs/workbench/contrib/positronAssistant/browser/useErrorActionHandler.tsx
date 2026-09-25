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
 * The error action handler selected in the ai.errorActions.target setting, kept
 * current as the setting and registrations change.
 * @returns The selected implementation, or undefined when errors should go to
 *   Posit Assistant.
 */
export function useErrorActionHandler(): IErrorActionHandler | undefined {
	const services = usePositronReactServicesContext();
	const errorActionsService = useMemo(() => services.get(IErrorActionsService), [services]);
	const [errorActionHandler, setErrorActionHandler] = useState(() => errorActionsService.getConfigured());

	useEffect(() => {
		const disposable = errorActionsService.onDidChange(() => setErrorActionHandler(errorActionsService.getConfigured()));
		return () => disposable.dispose();
	}, [errorActionsService]);

	return errorActionHandler;
}
