/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
