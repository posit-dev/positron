/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import "./positronPackages.css";

// React.
import React, { useEffect } from "react";

// Other dependencies.
import { IReactComponentContainer } from "../../../../base/browser/positronReactRenderer.js";
import { DisposableStore } from "../../../../base/common/lifecycle.js";
import { PositronPackagesContextProvider } from "./positronPackagesContext.js";
import { PackagesCore } from "./components/packagesCore.js";

export interface PositronConnectionsProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

export interface ViewsProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

export const PositronPackages = (
	props: React.PropsWithChildren<PositronConnectionsProps>
) => {
	// This allows us to introspect the size of the component. Which then allows
	// us to efficiently only render items that are in view.
	const [width, setWidth] = React.useState(props.reactComponentContainer.width);
	const [height, setHeight] = React.useState(
		props.reactComponentContainer.height
	);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			props.reactComponentContainer.onSizeChanged((size) => {
				setWidth(size.width);
				setHeight(size.height);
			})
		);
		return () => disposableStore.dispose();
	}, [props.reactComponentContainer]);

	return (
		<PositronPackagesContextProvider {...props}>
			<div className="positron-packages">
				<PackagesCore height={height} width={width} {...props} />
			</div>
		</PositronPackagesContextProvider>
	);
};
