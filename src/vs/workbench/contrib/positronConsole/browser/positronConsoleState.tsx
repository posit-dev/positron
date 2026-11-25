/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useMemo } from 'react';

// Other dependencies.
import { equals } from '../../../../base/common/arrays.js';
import { Event } from '../../../../base/common/event.js';
import { useExternalValue } from '../../../../base/browser/useExternalValue.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IPositronConsoleInstance } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

/**
 * The Positron console state.
 */
export interface PositronConsoleState {
	readonly positronConsoleInstances: IPositronConsoleInstance[];
	readonly activePositronConsoleInstance?: IPositronConsoleInstance;
	readonly consoleSessionListCollapsed: boolean;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (): PositronConsoleState => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronConsoleService = services.positronConsoleService;

	// The console list changes when a console starts or is deleted.
	const onDidChangePositronConsoleInstances = useMemo(() => Event.any(
		positronConsoleService.onDidStartPositronConsoleInstance,
		positronConsoleService.onDidDeletePositronConsoleInstance,
	), [positronConsoleService]);

	// The service builds a new array on each read, so compare the consoles one by one.
	const positronConsoleInstances = useExternalValue(
		onDidChangePositronConsoleInstances,
		() => positronConsoleService.positronConsoleInstances,
		equals,
	);

	const activePositronConsoleInstance = useExternalValue(
		positronConsoleService.onDidChangeActivePositronConsoleInstance,
		() => positronConsoleService.activePositronConsoleInstance,
	);

	// Return the Positron console state.
	return {
		consoleSessionListCollapsed: positronConsoleInstances.length <= 1,
		positronConsoleInstances,
		activePositronConsoleInstance,
	};
};
