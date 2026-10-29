/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useEventState } from '../../../../base/browser/ui/react/useEventState.js';
import { IErrorActionHandlerInfo, IErrorActionHandlerService } from '../common/errorAction.js';

/**
 * The active error action handler, which errors are sent to, kept current as it
 * changes.
 * @returns The handler, or undefined while the Fix and Explain actions
 * should hide. See {@link IErrorActionHandlerService.activeHandler}.
 */
export function useActiveErrorActionHandler(): IErrorActionHandlerInfo | undefined {
	const errorActionHandlerService = usePositronReactServicesContext().get(IErrorActionHandlerService);
	return useEventState(errorActionHandlerService.onDidChangeActiveHandler, () => errorActionHandlerService.activeHandler);
}
