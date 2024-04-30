/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * NewProjectConfiguration interface. Defines the configuration for a new project.
 */
export interface NewProjectConfiguration {
	readonly runtimeId: string;
	readonly projectType: string;
	readonly projectFolder: string;
	readonly initGitRepo: boolean;
	readonly pythonEnvType: string;
	readonly installIpykernel: boolean;
	readonly useRenv: boolean;
}
