/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import { URI } from 'vscode-uri';
import { substitute, beforeContainerSubstitute } from '../spec/spec-common/variableSubstitution';

/**
 * Labels identifying a dev container; also the inputs to ${devcontainerId}.
 */
export function devContainerIdLabels(workspaceFolder: string, configFile: string): Record<string, string> {
	return {
		'devcontainer.local_folder': workspaceFolder,
		'devcontainer.config_file': configFile,
	};
}

/**
 * Reads a devcontainer.json (JSONC) and expands the variables that can be
 * resolved before the container is running, per the dev container spec.
 */
export function readDevContainerConfig(configFile: string, workspaceFolder: string, containerWorkspaceFolder?: string): any {
	const config = jsonc.parse(fs.readFileSync(configFile, 'utf8'));
	return beforeContainerSubstitute(devContainerIdLabels(workspaceFolder, configFile), substitute({
		platform: process.platform,
		configFile: URI.file(configFile),
		localWorkspaceFolder: workspaceFolder,
		containerWorkspaceFolder,
		env: process.env,
	}, config));
}
