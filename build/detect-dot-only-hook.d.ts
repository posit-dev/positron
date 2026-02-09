/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

declare const detectDotOnlyHook: (reporter: (message: string, isError: boolean) => void) => NodeJS.ReadWriteStream;

export default detectDotOnlyHook;
