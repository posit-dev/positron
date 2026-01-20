/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

import { usePositronPackagesContext } from "../positronPackagesContext.js";
import { ListPackages } from "./listPackages.js";
import { IReactComponentContainer } from "../../../../../base/browser/positronReactRenderer.js";

interface PackagesCoreProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

export const PackagesCore = (
	props: React.PropsWithChildren<PackagesCoreProps>
) => {
	const context = usePositronPackagesContext();

	return (
		<>
			{context.activeSessionId === undefined ? (
				<div>No active instance</div>
			) : (
				<ListPackages {...props} />
			)}
		</>
	);
};
