/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// With --url-delay=<ms>, print the URL after a delay, as a slow-starting app does.
const urlDelayArg = process.argv.find(arg => arg.startsWith('--url-delay='));
const urlDelay = urlDelayArg ? Number(urlDelayArg.split('=')[1]) : 0;
const printUrl = () => console.log('Server started: http://localhost:8000');
if (urlDelay > 0) {
	setTimeout(printUrl, urlDelay);
} else {
	printUrl();
}

// With --keep-running, stay up until stopped, as a real app server does.
if (process.argv.includes('--keep-running')) {
	setInterval(() => { }, 1000);
}
