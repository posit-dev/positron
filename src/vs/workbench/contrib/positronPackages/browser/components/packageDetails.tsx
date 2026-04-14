/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './packageDetails.css';

// React.
import * as React from 'react';

// Other dependencies.
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';

interface PackageDetailsProps {
	pkg: ILanguageRuntimePackage | undefined;
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) {
		return localize('packageDetails.notAvailable', 'N/A');
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a date string into a human-readable format.
 */
function formatDate(dateString: string | undefined): string {
	if (!dateString) {
		return localize('packageDetails.notAvailable', 'N/A');
	}
	try {
		const date = new Date(dateString);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	} catch {
		return dateString;
	}
}

/**
 * Format download count with thousands separator.
 */
function formatDownloads(count: number | undefined): string {
	if (count === undefined) {
		return localize('packageDetails.notAvailable', 'N/A');
	}
	return count.toLocaleString();
}

export const PackageDetails: React.FC<PackageDetailsProps> = (props) => {
	const { pkg } = props;

	if (!pkg) {
		return (
			<div className='package-details-empty'>
				{localize('packageDetails.selectPackage', 'Select a package to view details')}
			</div>
		);
	}

	const hasMetadata = pkg.description || pkg.license || pkg.latestVersion;

	return (
		<div className='package-details'>
			<div className='package-details-header'>
				<span className='package-details-name'>{pkg.displayName}</span>
				<span className='package-details-version'>{pkg.version}</span>
			</div>

			{hasMetadata ? (
				<div className='package-details-content'>
					{pkg.description && (
						<div className='package-details-description'>
							{pkg.description}
						</div>
					)}

					<div className='package-details-metadata'>
						<div className='package-details-row'>
							<span className='package-details-label'>
								{localize('packageDetails.license', 'License')}
							</span>
							<span className='package-details-value'>
								{pkg.license || localize('packageDetails.notAvailable', 'N/A')}
							</span>
						</div>

						<div className='package-details-row'>
							<span className='package-details-label'>
								{localize('packageDetails.latestVersion', 'Latest')}
							</span>
							<span className='package-details-value'>
								{pkg.latestVersion || localize('packageDetails.notAvailable', 'N/A')}
								{pkg.latestVersion && pkg.latestVersion !== pkg.version && (
									<span className='package-details-update-available'>
										{localize('packageDetails.updateAvailable', '(update available)')}
									</span>
								)}
							</span>
						</div>

						<div className='package-details-row'>
							<span className='package-details-label'>
								{localize('packageDetails.size', 'Size')}
							</span>
							<span className='package-details-value'>
								{formatBytes(pkg.packageSize)}
							</span>
						</div>

						<div className='package-details-row'>
							<span className='package-details-label'>
								{localize('packageDetails.published', 'Published')}
							</span>
							<span className='package-details-value'>
								{formatDate(pkg.publishedDate)}
							</span>
						</div>

						<div className='package-details-row'>
							<span className='package-details-label'>
								{localize('packageDetails.downloads', 'Downloads')}
							</span>
							<span className='package-details-value'>
								{formatDownloads(pkg.downloads)}
							</span>
						</div>
					</div>
				</div>
			) : (
				<div className='package-details-no-metadata'>
					{localize('packageDetails.noMetadata', 'Package metadata not available')}
				</div>
			)}
		</div>
	);
};
