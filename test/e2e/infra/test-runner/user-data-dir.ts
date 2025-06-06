/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Returns a deterministic user data dir path based on the current date and environment.
 * This is useful for ensuring consistent test environments across runs.
 */
export function getDeterministicUserDataDir(testDataPath: string): string {
	const today = new Date();
	const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

	const id = process.env.CI
		? process.env.GITHUB_RUN_ID || `-${dateString}`
		: dateString;

	console.log(`✓ User data dir: ${testDataPath}/d-${id}`);
	return `${testDataPath}/d-${id}`;
}
