/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronPlotsServices interface. Defines the set of services that are required by the Positron plots.
 */
export interface PositronPlotsServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
}

/**
 * The Positron plots state.
 */
export interface PositronPlotsState extends PositronPlotsServices {
}

/**
 * The usePositronPlotsState custom hook.
 * @returns The hook.
 */
export const usePositronPlotsState = (services: PositronPlotsServices): PositronPlotsState => {
	// TODO: Learn React.
	return { ...services };
};
