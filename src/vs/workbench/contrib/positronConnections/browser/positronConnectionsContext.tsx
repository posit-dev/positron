/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';

export interface PositronConnectionsEnvironment {
	readonly reactComponentContainer: IReactComponentContainer;
}

const PositronConnectionsContext = createContext<PositronConnectionsEnvironment>(undefined!);

export const PositronConnectionsContextProvider = (props: PropsWithChildren<PositronConnectionsEnvironment>) => {
	return (
		<PositronConnectionsContext.Provider value={props}>
			{props.children}
		</PositronConnectionsContext.Provider>
	);
};

export const usePositronConnectionsContext = () => useContext(PositronConnectionsContext);
