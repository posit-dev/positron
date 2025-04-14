/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';

export function getSystemArchitecture(): string {
	const arch = os.arch();

	switch (arch) {
		case 'arm64':
			return 'arm64';
		case 'x64':
		case 'x86_64':
			return 'x64';
		case 'ia32':
		case 'x32':
			return 'x86';
		default:
			return arch;
	}
}
