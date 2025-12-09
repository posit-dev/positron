/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface PackageConfiguration {
	name: string;
	version: string;
}

export function getPackageConfig(): PackageConfiguration {
	return require('../../../package.json');
}
export const includeAllConfiguredFeatures = true;
