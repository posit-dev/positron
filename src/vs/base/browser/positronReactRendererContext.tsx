/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';

// Other dependencies.
import { PositronReactServices } from './positronReactServices.js';

/**
 * PositronReactServicesContext.
 */
export const PositronReactServicesContext = createContext<PositronReactServices>(undefined!);

/**
 * usePositronReactServicesContext hook.
 * @returns The Positron React services context.
 */
export const usePositronReactServicesContext = () => useContext(PositronReactServicesContext);
