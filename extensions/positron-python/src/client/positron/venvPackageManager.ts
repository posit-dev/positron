/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PipPackageManager } from './pipPackageManager';

/**
 * Venv Package Manager
 *
 * Provides package management functionality for Python venv environments.
 * Extends PipPackageManager since venv uses pip for package management.
 *
 * This class exists to explicitly identify and handle venv environments,
 * allowing for venv-specific behavior to be added in the future if needed.
 */
export class VenvPackageManager extends PipPackageManager {
	// VenvPackageManager inherits all functionality from PipPackageManager.
	// Since venv environments use pip for package management, the base class
	// implementation is sufficient. This class can be extended with
	// venv-specific behavior in the future if needed.
}
