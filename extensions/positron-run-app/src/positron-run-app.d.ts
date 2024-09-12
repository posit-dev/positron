/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RunAppOptions {
	label: string;

	commandLine: string;

	urlPath?: string;

	env?: { [key: string]: string | null | undefined };
}

export interface PositronRunAppApi {
	runApplication(options: RunAppOptions): Promise<void>;
}
