/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerParsedArgs } from 'vs/server/node/serverEnvironmentService';

export async function validateLicenseKey(connectionToken: string, args: ServerParsedArgs): Promise<boolean> {
	return true;
}
