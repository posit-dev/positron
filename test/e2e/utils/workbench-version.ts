/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { runDockerCommand } from '../fixtures/test-setup/docker-utils';

/**
 * Represents a Workbench version in YYYY.MM.PATCH format
 */
export class WorkbenchVersion {
	constructor(
		public readonly year: number,
		public readonly month: number,
		public readonly patch: number
	) { }

	/**
	 * Parse a version string in format "YYYY.MM.PATCH+BUILD.TYPE"
	 * Example: "2026.05.0+218.pro2" -> WorkbenchVersion(2026, 5, 0)
	 */
	static parse(versionString: string): WorkbenchVersion {
		// Extract just the version part before the + sign
		const versionPart = versionString.split('+')[0].trim();
		const parts = versionPart.split('.');

		if (parts.length < 2) {
			throw new Error(`Invalid version format: ${versionString}. Expected format: YYYY.MM.PATCH`);
		}

		const year = parseInt(parts[0], 10);
		const month = parseInt(parts[1], 10);
		const patch = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

		if (isNaN(year) || isNaN(month) || isNaN(patch)) {
			throw new Error(`Invalid version numbers in: ${versionString}`);
		}

		return new WorkbenchVersion(year, month, patch);
	}

	/**
	 * Fetch the Workbench version from the Docker container
	 */
	static async fetchFromContainer(containerName: string = 'test'): Promise<WorkbenchVersion> {
		const result = await runDockerCommand(
			`docker exec ${containerName} rstudio-server version`,
			'Get Workbench version'
		);

		// Parse output like: "2026.05.0+218.pro2 Workbench (Golden Wattle) for Ubuntu Jammy"
		const firstLine = result.stdout.trim().split('\n')[0];
		const versionMatch = firstLine.match(/^([\d.]+\+[\w.]+)/);

		if (!versionMatch) {
			throw new Error(`Could not parse version from: ${firstLine}`);
		}

		return WorkbenchVersion.parse(versionMatch[1]);
	}

	/**
	 * Check if this version is greater than another version
	 */
	isGreaterThan(other: WorkbenchVersion | string): boolean {
		const otherVersion = typeof other === 'string' ? WorkbenchVersion.parse(other) : other;

		if (this.year !== otherVersion.year) {
			return this.year > otherVersion.year;
		}
		if (this.month !== otherVersion.month) {
			return this.month > otherVersion.month;
		}
		return this.patch > otherVersion.patch;
	}

	/**
	 * Check if this version is greater than or equal to another version
	 */
	isGreaterThanOrEqualTo(other: WorkbenchVersion | string): boolean {
		return this.equals(other) || this.isGreaterThan(other);
	}

	/**
	 * Check if this version is less than another version
	 */
	isLessThan(other: WorkbenchVersion | string): boolean {
		const otherVersion = typeof other === 'string' ? WorkbenchVersion.parse(other) : other;
		return !this.isGreaterThanOrEqualTo(otherVersion);
	}

	/**
	 * Check if this version is less than or equal to another version
	 */
	isLessThanOrEqualTo(other: WorkbenchVersion | string): boolean {
		return this.equals(other) || this.isLessThan(other);
	}

	/**
	 * Check if this version equals another version
	 */
	equals(other: WorkbenchVersion | string): boolean {
		const otherVersion = typeof other === 'string' ? WorkbenchVersion.parse(other) : other;
		return this.year === otherVersion.year &&
			this.month === otherVersion.month &&
			this.patch === otherVersion.patch;
	}

	/**
	 * Return string representation in YYYY.MM.PATCH format
	 */
	toString(): string {
		return `${this.year}.${this.month.toString().padStart(2, '0')}.${this.patch}`;
	}
}
