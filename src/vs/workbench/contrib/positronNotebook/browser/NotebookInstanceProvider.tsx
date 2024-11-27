/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

/**
 * Context to be used by React components to get access to the notebook instance for given notebook provided by the extension host.
 */
export const NotebookInstanceContext = React.createContext<PositronNotebookInstance | undefined>(undefined);

/**
 * Hook to be used by React components to get access to the instance for notebook
 */
export function NotebookInstanceProvider({
	instance,
	children
}: { instance: PositronNotebookInstance; children: React.ReactNode }) {
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
 * @returns Notebook options for the current notebook instance.
 */
export function useNotebookOptions() {
	const instance = useNotebookInstance();
	// Wrap in a usestate so we can trigger rerendering of notebooks when options change.
	const [notebookOptions, setNotebookOptions] = React.useState(instance.notebookOptions);

	React.useEffect(() => {
		const listener = instance.notebookOptions.onDidChangeOptions(() => {
			setNotebookOptions(instance.notebookOptions);
		});
		return () => listener.dispose();
	}, [instance.notebookOptions]);

	return notebookOptions;
}
