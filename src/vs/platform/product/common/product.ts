/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { globals } from 'vs/base/common/platform';
import { env } from 'vs/base/common/process';
import { IProductConfiguration } from 'vs/base/common/product';
import { ISandboxConfiguration } from 'vs/base/parts/sandbox/common/sandboxTypes';

/**
 * @deprecated You MUST use `IProductService` if possible.
 */
let product: IProductConfiguration;

// Native sandbox environment
if (typeof globals.vscode !== 'undefined' && typeof globals.vscode.context !== 'undefined') {
	const configuration: ISandboxConfiguration | undefined = globals.vscode.context.configuration();
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
}

// Web environment or unknown
else {

	// Built time configuration (do NOT modify)
	product = { /*BUILD->INSERT_PRODUCT_CONFIGURATION*/ } as IProductConfiguration;

	// Running out of sources
	if (Object.keys(product).length === 0) {
		Object.assign(product, {
			version: '1.78.0-dev',
			// --- Start Positron ---
			positronVersion: '2022.10.0',
			nameShort: 'Positron',
			nameLong: 'Positron',
			applicationName: 'positron',
			dataFolderName: '.positron',
			urlProtocol: 'positron',
			reportIssueUrl: 'https://github.com/rstudio/positron/issues/new',
			licenseName: 'MIT',
			licenseUrl: 'https://github.com/rstudio/positron/blob/main/LICENSE.txt',
			serverLicenseUrl: 'https://github.com/rstudio/positron/blob/main/LICENSE.txt'
			// --- End Positron ---
		});
	}
}

/**
 * @deprecated You MUST use `IProductService` if possible.
 */
export default product;
