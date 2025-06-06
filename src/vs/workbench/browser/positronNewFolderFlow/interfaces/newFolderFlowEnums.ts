/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The NewFolderFlowStep enum is a list of steps in the New Folder Flow.
 * Each step corresponds to a component that should be rendered for that step.
 *
 * New steps can be added to this enum as needed.
 */
export enum NewFolderFlowStep {
	None = 'none',
	FolderTemplateSelection = 'folderTemplateSelection',
	FolderNameLocation = 'folderNameLocation',
	PythonEnvironment = 'pythonEnvironment',
	RConfiguration = 'rConfiguration'
}

/**
 * The EnvironmentSetupType enum includes the types of environment setup options.
 * - NewEnvironment: Create a new environment.
 * - ExistingEnvironment: Use an existing environment.
 */
export enum EnvironmentSetupType {
	NewEnvironment = 'newEnvironment',
	ExistingEnvironment = 'existingEnvironment'
}

/**
 * PythonEnvironmentProvider enum includes the types of Python environments that are supported by the
 * New Folder Flow.
 */
export enum PythonEnvironmentProvider {
	Venv = 'Venv',
	Conda = 'Conda',
	Uv = 'uv'
}
