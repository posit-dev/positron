/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from '../../../base/common/severity.js';
import { URI } from '../../../base/common/uri.js';
import * as nls from '../../../nls.js';
import { IExtensionManifest } from './extensions.js';
import { isValidVersion, normalizeVersion, parseVersion } from './extensionValidator.js';

type ProductDate = string | Date | undefined;

export function validatePositronExtensionManifest(positronVersion: string, productDate: ProductDate, extensionLocation: URI, extensionManifest: IExtensionManifest, extensionIsBuiltin: boolean): [Severity, string][] {
	const validations: [Severity, string][] = [];
	const notices: string[] = [];
	const isValid = isValidPositronExtensionVersion(positronVersion, productDate, extensionManifest, extensionIsBuiltin, notices);
	if (!isValid) {
		for (const notice of notices) {
			validations.push([Severity.Error, notice]);
		}
	}
	return validations;
}

export function isValidPositronExtensionVersion(positronVersion: string, productDate: ProductDate, extensionManifest: IExtensionManifest, extensionIsBuiltin: boolean, notices: string[]): boolean {

	if (extensionIsBuiltin || (typeof extensionManifest.main === 'undefined' && typeof extensionManifest.browser === 'undefined')) {
		// No version check for builtin or declarative extensions
		return true;
	}

	if (!(extensionManifest.engines && extensionManifest.engines.positron)) {
		// No version check for extensions that don't specify a required version
		// of Positron. Unlike VS Code, we don't require an extension to be
		// specific about its version requirements; an extension that doesn't
		// specify a version requirement is assumed to be compatible with any
		// version of Positron.
		return true;
	}

	const requestedVersion = extensionManifest.engines.positron;
	if (requestedVersion === '*') {
		// No version check for extensions that specify a wildcard version
		return true;
	}

	return isVersionValid(positronVersion, productDate, requestedVersion, notices);
}

function isVersionValid(currentVersion: string, date: ProductDate, requestedVersion: string, notices: string[] = []): boolean {

	const desiredVersion = normalizeVersion(parseVersion(requestedVersion));
	if (!desiredVersion) {
		notices.push(nls.localize('versionSyntax', "Could not parse `engines.positron` value {0}. Please use, for example: ^2022.10.0, ^2024.5.x, etc.", requestedVersion));
		return false;
	}

	if (!isValidVersion(currentVersion, date, desiredVersion)) {
		notices.push(nls.localize('versionMismatch', "Extension is not compatible with Positron {0}. Extension requires: {1}.", currentVersion, requestedVersion));
		return false;
	}

	return true;
}
