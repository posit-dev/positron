/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The main-thread secret-storage key under which an extension's `SecretStorage` entry is stored. */
export function extensionSecretStorageKey(extensionId: string, key: string): string {
	return JSON.stringify({ extensionId, key });
}
