/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IConfig {
	// The client ID of the GitHub OAuth app
	gitHubClientId: string;
	gitHubClientSecret?: string;
}

// For easy access to mixin client ID and secret
export const Config: IConfig = {
	// --- Start Positron ---
	// Replace the "GitHub for VS Code" client ID with Positron's client ID
	// gitHubClientId: '01ab8ac9400c4e429b23'
	gitHubClientId: 'Ov23lilj1d6nFMvW4QfI'
	// --- End Positron ---
};
