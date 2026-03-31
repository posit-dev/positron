/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IExtensionGalleryService, IGalleryExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { isValidPositronExtensionVersion } from '../../../../platform/extensions/common/positronExtensionValidator.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Given a gallery extension (typically the latest version), checks whether its
 * engines.positron requirement is compatible with the running Positron version.
 * If not, walks back through older versions to find the latest compatible one.
 *
 * Returns the compatible gallery extension, or null if no compatible version exists.
 * Returns the original gallery extension unchanged if it has no engines.positron
 * requirement or if it is already compatible.
 */
export async function getLatestPositronCompatibleVersion(
	gallery: IGalleryExtension,
	galleryService: IExtensionGalleryService,
	productService: IProductService,
	logService: ILogService,
	token: CancellationToken,
): Promise<IGalleryExtension | null> {
	// Sanity check: if we are not running in Positron, skip the check entirely.
	const positronVersion = productService.positronVersion;
	if (!positronVersion) {
		return gallery;
	}

	// Fetch the manifest for the candidate version to check engines.positron.
	const manifest = await galleryService.getManifest(gallery, token);

	// Check for cancellation again before proceeding.
	if (token.isCancellationRequested) {
		return null;
	}

	// If the manifest is unavailable, assume compatible rather than blocking
	// the update entirely.
	if (!manifest) {
		return gallery;
	}

	// If the candidate version is already compatible, return it immediately.
	if (isPositronCompatible(manifest, positronVersion, productService)) {
		return gallery;
	}

	// The latest version is incompatible. Walk back through older versions.
	logService.info(
		`Extension '${gallery.identifier.id}' v${gallery.version} requires ` +
		`engines.positron '${manifest.engines?.positron}' but Positron version is ` +
		`'${positronVersion}'. Searching for a compatible older version.`
	);

	// Fetch all published versions.
	const allVersions = await galleryService.getAllVersions(gallery.identifier);

	// Check for cancellation again before proceeding.
	if (token.isCancellationRequested) {
		return null;
	}

	// Versions are returned newest-first.
	for (const versionEntry of allVersions) {
		// Skip the version we already checked.
		if (versionEntry.version === gallery.version) {
			continue;
		}

		// Fetch the gallery extension object for this specific version.
		const olderGalleryExtensions = await galleryService.getExtensions(
			[{ ...gallery.identifier, version: versionEntry.version }],
			token,
		);

		// Check for cancellation again before proceeding.
		if (token.isCancellationRequested) {
			return null;
		}

		// getExtensions may return empty if the version was yanked or unavailable.
		const olderGallery = olderGalleryExtensions[0];
		if (!olderGallery) {
			continue;
		}

		// Fetch the full manifest to inspect engines.positron for this version.
		const olderManifest = await galleryService.getManifest(olderGallery, token);

		// Check for cancellation again before proceeding.
		if (token.isCancellationRequested) {
			return null;
		}

		// Skip versions whose manifest cannot be fetched.
		if (!olderManifest) {
			continue;
		}

		// If a compatible version is found, return it.
		if (isPositronCompatible(olderManifest, positronVersion, productService)) {
			logService.info(
				`Found compatible version v${versionEntry.version} for extension ` +
				`'${gallery.identifier.id}'.`
			);
			return olderGallery;
		}
	}

	// No compatible version was found.
	logService.info(
		`No compatible version found for extension '${gallery.identifier.id}' ` +
		`with Positron ${positronVersion}.`
	);
	return null;
}

function isPositronCompatible(
	manifest: IExtensionManifest,
	positronVersion: string,
	productService: IProductService,
): boolean {
	// No positron engine requirement; compatible with any version.
	if (!manifest.engines?.positron) {
		return true;
	}

	// Validate the engines.positron semver range against the running version.
	const notices: string[] = [];
	return isValidPositronExtensionVersion(
		positronVersion,
		productService.date,
		manifest,
		false,
		notices,
	);
}
