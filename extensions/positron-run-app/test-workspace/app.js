/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

console.log('Server started: http://localhost:8000');

// With --keep-running, stay up until stopped, as a real app server does.
if (process.argv.includes('--keep-running')) {
	setInterval(() => { }, 1000);
}
