/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env } from '../../../base/common/process.js';
import { IProductConfiguration } from '../../../base/common/product.js';
import { ISandboxConfiguration } from '../../../base/parts/sandbox/common/sandboxTypes.js';

/**
 * @deprecated It is preferred that you use `IProductService` if you can. This
 * allows web embedders to override our defaults. But for things like `product.quality`,
 * the use is fine because that property is not overridable.
 */
let product: IProductConfiguration;

// Native sandbox environment
const vscodeGlobal = (globalThis as { vscode?: { context?: { configuration(): ISandboxConfiguration | undefined } } }).vscode;
if (typeof vscodeGlobal !== 'undefined' && typeof vscodeGlobal.context !== 'undefined') {
	const configuration: ISandboxConfiguration | undefined = vscodeGlobal.context.configuration();
	if (configuration) {
		product = configuration.product;
	} else {
		throw new Error('Sandbox: unable to resolve product configuration from preload script.');
	}
}
// _VSCODE environment
else if (globalThis._VSCODE_PRODUCT_JSON && globalThis._VSCODE_PACKAGE_JSON) {
	// Obtain values from product.json and package.json-data
	product = globalThis._VSCODE_PRODUCT_JSON as unknown as IProductConfiguration;

	// Running out of sources
	if (env['VSCODE_DEV']) {
		Object.assign(product, {
			nameShort: `${product.nameShort} Dev`,
			nameLong: `${product.nameLong} Dev`,
			dataFolderName: `${product.dataFolderName}-dev`,
			serverDataFolderName: product.serverDataFolderName ? `${product.serverDataFolderName}-dev` : undefined
		});
	}

	// Version is added during built time, but we still
	// want to have it running out of sources so we
	// read it from package.json only when we need it.
	if (!product.version) {
		const pkg = globalThis._VSCODE_PACKAGE_JSON as { version: string };

		Object.assign(product, {
			version: pkg.version
		});
	}

	// --- Start PWB: Custom extensions gallery
	if (env['EXTENSIONS_GALLERY']) {
		Object.assign(product, {
			extensionsGallery: JSON.parse(env['EXTENSIONS_GALLERY'])
		});
	}
	// --- End PWB: Custom extensions gallery
}

// Web environment or unknown
else {

	// Built time configuration (do NOT modify)
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	product = { /*BUILD->INSERT_PRODUCT_CONFIGURATION*/ } as unknown as IProductConfiguration;

	// Running out of sources
	if (Object.keys(product).length === 0) {
		Object.assign(product, {
			version: '1.105.0-dev',
			// --- Start Positron ---
			// This only applies to dev builds where it is not possible to read the
			// product configuration. Release builds replace the product configuration
			// during the build. See INSERT_PRODUCT_CONFIGURATION above.
			positronVersion: '2025.11.0',
			positronBuildNumber: '0',
			date: new Date().toISOString(),
			nameShort: 'Positron Dev',
			nameLong: 'Positron Dev',
			applicationName: 'positron',
			dataFolderName: '.positron',
			urlProtocol: 'code-oss',
			reportIssueUrl: 'https://github.com/posit-dev/positron/issues/new',
			licenseName: 'Software Evaluation License',
			licenseUrl: 'https://github.com/posit-dev/positron/tree/main?tab=License-1-ov-file',
			serverLicenseUrl: 'https://posit.co/about/eula/',
			linkProtectionTrustedDomains: [
				'https://open-vsx.org',
				'https://github.com/posit-dev/positron',
				'https://positron.posit.co',
				'https://github.com/login/device',
				'https://posit.co'
			]
			// --- End Positron ---
		});
	}
}

export default product;
