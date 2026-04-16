/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ListPackages } from './listPackages.js';

interface PackagesCoreProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

export const PackagesCore = (
	props: React.PropsWithChildren<PackagesCoreProps>,
) => {
	return (
		<ListPackages {...props} />
	);
};
