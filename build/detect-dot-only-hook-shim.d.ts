/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module './detect-dot-only-hook.js' {
	const detectDotOnlyHook: (reporter: (message: string, isError: boolean) => void) => NodeJS.ReadWriteStream;
	export default detectDotOnlyHook;
}
