/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';

/**
 * Create the notebook visibility context.
 */
const NotebookVisibilityContext = createContext<ISettableObservable<boolean>>(undefined!);

/**
 * Provider component for notebook visibility state
 */
export const NotebookVisibilityProvider = ({
	isVisible,
	children
}: PropsWithChildren<{ isVisible: ISettableObservable<boolean> }>) => {
	return (
		<NotebookVisibilityContext.Provider value={isVisible}>
			{children}
		</NotebookVisibilityContext.Provider>
	);
};

/**
 * Hook to access the notebook visibility state
 * @returns The current visibility state as a boolean
 */
export const useNotebookVisibility = () => {
	return useContext(NotebookVisibilityContext)
};
