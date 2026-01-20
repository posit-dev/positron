/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from "react";

// Other dependencies.
import { IReactComponentContainer } from "../../../../base/browser/positronReactRenderer.js";
import {
	PositronPackagesState,
	usePositronPackagesState,
} from "./positronPackagesState.js";

export interface PositronPackagesEnvironment {
	readonly reactComponentContainer: IReactComponentContainer;
}

const PositronPackagesContext = createContext<PositronPackagesState>(
	undefined!
);

export const PositronPackagesContextProvider = (
	props: PropsWithChildren<PositronPackagesEnvironment>
) => {
	const state = usePositronPackagesState(props);

	return (
		<PositronPackagesContext.Provider value={state}>
			{props.children}
		</PositronPackagesContext.Provider>
	);
};

export const usePositronPackagesContext = () =>
	useContext(PositronPackagesContext);
