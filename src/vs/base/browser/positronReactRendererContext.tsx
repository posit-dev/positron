/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext } from 'react';

// Other dependencies.
import { PositronReactServices } from './positronReactServices.js';
import { PositronHoverManagerProvider } from '../../platform/positronActionBar/browser/usePositronHoverManager.js';

/**
 * PositronReactServicesContext.
 */
export const PositronReactServicesContext = createContext<PositronReactServices>(undefined!);

/**
 * PositronReactServicesProvider component.
 * Provides the Positron React services context, and a shared hover manager, to children.
 */
export const PositronReactServicesProvider = ({ children }: { children: React.ReactNode }) => {
	return (
		<PositronReactServicesContext.Provider value={PositronReactServices.services}>
			<PositronHoverManagerProvider>
				{children}
			</PositronHoverManagerProvider>
		</PositronReactServicesContext.Provider>
	);
};

/**
 * usePositronReactServicesContext hook.
 * @returns The Positron React services context.
 */
export const usePositronReactServicesContext = () => useContext(PositronReactServicesContext);
