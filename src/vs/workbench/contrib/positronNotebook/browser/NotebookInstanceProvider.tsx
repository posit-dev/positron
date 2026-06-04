/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

/**
 * Context to be used by React components to get access to the notebook instance for given notebook provided by the extension host.
 */
export const NotebookInstanceContext = React.createContext<IPositronNotebookInstance | undefined>(undefined);

/**
 * Hook to be used by React components to get access to the instance for notebook
 */
export function NotebookInstanceProvider({
	instance,
	children
}: { instance: IPositronNotebookInstance; children: React.ReactNode }) {
	return <NotebookInstanceContext.Provider value={instance}>{children}</NotebookInstanceContext.Provider>;
}

/**
 * Hook to be used by React components to get access to the instance for notebook
 */
export function useNotebookInstance() {
	const instance = React.useContext(NotebookInstanceContext);
	if (!instance) {
		throw new Error('No instance provided');
	}
	return instance;
}

/**
 * Grab notebook config options from the current notebook instance.
 *
 * notebookOptions itself is not mutable but the options it provides
 * can be updated. This hook forces a re-render whenever options change
 * so that consumers get the latest values.
 *
 * @returns Notebook options for the current notebook instance.
 */
export function useNotebookOptions() {
	const instance = useNotebookInstance();
	const [, forceUpdate] = React.useReducer((count: number) => count + 1, 0);

	React.useEffect(() => {
		const listener = instance.notebookOptions.onDidChangeOptions(() => {
			forceUpdate();
		});
		return () => listener.dispose();
	}, [instance.notebookOptions]);

	return instance.notebookOptions;
}
