/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';

/**
 * React context providing the scoped context key service for a notebook cell subtree.
 */
export const CellScopedContextKeyServiceContext = React.createContext<IScopedContextKeyService | undefined>(undefined);

/**
 * Provider component to make a cell's scoped context key service available to its children.
 *
 * @param props.service - The scoped context key service for this cell
 * @param props.children - React children that need access to the service
 */
export function CellScopedContextKeyServiceProvider({ service, children }: { service: IScopedContextKeyService | undefined; children: React.ReactNode; }) {
	return <CellScopedContextKeyServiceContext.Provider value={service}>{children}</CellScopedContextKeyServiceContext.Provider>;
}

/**
 * Hook to consume the cell-scoped context key service from React context.
 *
 * @returns The scoped context key service, if available.
 */
export function useCellScopedContextKeyService(): IScopedContextKeyService | undefined {
	return React.useContext(CellScopedContextKeyServiceContext);
}
