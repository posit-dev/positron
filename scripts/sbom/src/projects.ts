/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Project } from './types';

/**
 * List of projects to include in the SBOM.
 * Paths are relative to the repository root.
 *
 * Note: extensions/positron-copilot-chat and extensions/positron-r/ark
 * are git submodules and must be initialized before SBOM generation.
 */
export const PROJECTS: Project[] = [
	{
		name: 'Positron Core',
		path: '.',
		type: 'npm'
	},
	{
		name: 'Positron CLI',
		path: './cli',
		type: 'rust'
	},
	{
		name: 'Positron Copilot Chat',
		path: './extensions/positron-copilot-chat',
		type: 'npm'
	},
	{
		name: 'Ark (R Kernel)',
		path: './extensions/positron-r/ark/crates/ark',
		type: 'rust'
	}
];
