/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as positron from 'positron';

export function getUserAgent(): string {
	const base = `Positron/${positron.version}+${positron.buildNumber}`;
	return `${base} (${os.platform()}) positron.next-edit-suggestions`;
}
