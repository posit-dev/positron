/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fromNow } from '../../../base/common/date.js';
import { isLinuxSnap } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { IOSProperties } from '../../native/common/native.js';
import { IProductService } from '../../product/common/productService.js';
import { process } from '../../../base/parts/sandbox/electron-browser/globals.js';

export function createNativeAboutDialogDetails(productService: IProductService, osProps: IOSProperties): { title: string; details: string; detailsToCopy: string } {
	// --- Start Positron ---
	// Show the Positron version instead of the Code - OSS version
	// let version = productService.version;
	let version = productService.positronVersion;
	// --- End Positron ---
	if (productService.target) {
		version = `${version} (${productService.target} setup)`;
	} else if (productService.darwinUniversalAssetId) {
		version = `${version} (Universal)`;
	}

	const getDetails = (useAgo: boolean): string => {
		// --- Start Positron ---
		// Note: This is heavily modified from the original Code - OSS
		// version because there is a limit of 10 placeholders in localization strings,
		// and we need 12 of them.
		if (productService.positronVersion) {
			const productDetail = localize({ key: 'productDetail', comment: ['Product version details; Code - OSS needs no translation'] },
				"{0} Version: {1} build {2}\nCode - OSS Version: {3}\nCommit: {4}\nDate: {5}",
				productService.nameLong,
				version,
				productService.positronBuildNumber,
				productService.version || 'Unknown',
				productService.commit || 'Unknown',
				productService.date ? `${productService.date}${useAgo ? ' (' + fromNow(new Date(productService.date), true) + ')' : ''}` : 'Unknown',
			);
			return localize({ key: 'aboutDetail', comment: ['Electron, Chromium, Node.js and V8 are product names that need no translation'] },
				"{0}\nElectron: {1}\nChromium: {2}\nNode.js: {3}\nV8: {4}\nOS: {5}",
				productDetail,
				process.versions['electron'],
				process.versions['chrome'],
				process.versions['node'],
				process.versions['v8'],
				`${osProps.type} ${osProps.arch} ${osProps.release}${isLinuxSnap ? ' snap' : ''}`
			);
		}
		// --- End Positron ---

		return localize({ key: 'aboutDetail', comment: ['Electron, Chromium, Node.js and V8 are product names that need no translation'] },
			"Version: {0}\nCommit: {1}\nDate: {2}\nElectron: {3}\nElectronBuildId: {4}\nChromium: {5}\nNode.js: {6}\nV8: {7}\nOS: {8}",
			version,
			productService.commit || 'Unknown',
			productService.date ? `${productService.date}${useAgo ? ' (' + fromNow(new Date(productService.date), true) + ')' : ''}` : 'Unknown',
			process.versions['electron'],
			process.versions['microsoft-build'],
			process.versions['chrome'],
			process.versions['node'],
			process.versions['v8'],
			`${osProps.type} ${osProps.arch} ${osProps.release}${isLinuxSnap ? ' snap' : ''}`
		);
	};

	const details = getDetails(true);
	const detailsToCopy = getDetails(false);

	// --- Start Positron ---
	const aboutProductHeader = localize({ key: 'aboutProductHeader', comment: ['Header for the about dialog'] },
		"{0} by {1}",
		productService.nameLong,
		productService.companyName
	);
	// --- End Positron ---

	return {
		// --- Start Positron ---
		/*
		title: productService.nameLong,
		*/
		// Use Positron title
		title: aboutProductHeader,
		// --- End Positron ---
		details: details,
		detailsToCopy: detailsToCopy
	};
}
