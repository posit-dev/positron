/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useEventState } from '../../../../base/browser/ui/react/useEventState.js';
import { IErrorAssistantInfo, IErrorAssistantService } from '../common/errorAssistant.js';

/**
 * The active error assistant, which errors are sent to, kept current as it
 * changes.
 * @returns The assistant, or undefined when there is nowhere to send errors.
 */
export function useActiveErrorAssistant(): IErrorAssistantInfo | undefined {
	const errorAssistantService = usePositronReactServicesContext().get(IErrorAssistantService);
	return useEventState(errorAssistantService.onDidChangeActiveAssistant, () => errorAssistantService.activeAssistant);
}
