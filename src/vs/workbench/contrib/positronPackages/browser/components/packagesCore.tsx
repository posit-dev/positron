/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './packagesCore.css';

// React.
import React, { useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ListPackages } from './listPackages.js';
import { PackageDetails } from './packageDetails.js';

// Height allocated for the details panel when a package is selected
const DETAILS_PANEL_HEIGHT = 180;

interface PackagesCoreProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

export const PackagesCore = (
	props: React.PropsWithChildren<PackagesCoreProps>,
) => {
	const { height } = props;
	const { activeInstance } = usePositronPackagesContext();
	const services = usePositronReactServicesContext();

	const [packages, setPackages] = useState<ILanguageRuntimePackage[]>([]);
	const [selectedPackageName, setSelectedPackageName] = useState<string | undefined>();

	// Track packages from the active instance
	useEffect(() => {
		if (!activeInstance) {
			setPackages([]);
			return;
		}

		setPackages(activeInstance.packages);
		const disposables = new DisposableStore();
		disposables.add(activeInstance.onDidRefreshPackagesInstance((pkgs) => {
			setPackages(pkgs);
		}));

		return () => disposables.dispose();
	}, [activeInstance]);

	// Track selected package from the service
	useEffect(() => {
		// Set initial value
		setSelectedPackageName(services.positronPackagesService.selectedPackage);

		// Subscribe to changes
		const disposables = new DisposableStore();
		disposables.add(services.positronPackagesService.onDidChangeSelectedPackage((pkgName) => {
			setSelectedPackageName(pkgName);
		}));

		return () => disposables.dispose();
	}, [services.positronPackagesService]);

	// Find the selected package object with full metadata
	const selectedPackage = useMemo(() => {
		if (!selectedPackageName) {
			return undefined;
		}
		return packages.find((pkg) => pkg.name === selectedPackageName);
	}, [selectedPackageName, packages]);

	// Calculate heights: when a package is selected, allocate space for details panel
	const hasSelection = Boolean(selectedPackage);
	const listHeight = hasSelection ? Math.max(height - DETAILS_PANEL_HEIGHT, 100) : height;
	const detailsHeight = hasSelection ? DETAILS_PANEL_HEIGHT : 0;

	return (
		<div className='packages-core'>
			<div className='packages-core-list' style={{ height: listHeight }}>
				<ListPackages {...props} height={listHeight} />
			</div>
			{hasSelection && (
				<div className='packages-core-details' style={{ height: detailsHeight }}>
					<PackageDetails pkg={selectedPackage} />
				</div>
			)}
		</div>
	);
};
