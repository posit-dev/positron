import * as path from "path";
import * as util from "util";
import { LOGGER } from "./extension";
import { exec } from "child_process";

const execPromise = util.promisify(exec);

/**
 * Check if Conda is installed by running `conda --version`
 */
export async function isCondaAvailable(): Promise<boolean> {
	try {
		await execPromise("conda --version");
		return true;
	} catch {
		return false;
	}
}

/**
 * Retrieve Conda environment paths using `conda env list --json`
 */
export async function getCondaEnvironments(): Promise<string[]> {
	try {
		const { stdout } = await execPromise("conda env list --json");
		const envs = JSON.parse(stdout).envs as string[];
		return envs;
	} catch (error) {
		LOGGER.error("Failed to retrieve Conda environments:", error);
		return [];
	}
}

/**
 * Discover R binaries inside Conda environments
 */

/**
 * Get expected R binary path inside a Conda environment
 */
export function getCondaRPaths(envPath: string): string[] {
	const paths: string[] = [];
	if (process.platform !== "win32") {
		paths.push(path.join(envPath, "bin", "R"));
	} else {
		paths.push(path.join(envPath, "Lib", "R", "bin", "x64", "R.exe")); // Prioritise x64 binaries
		paths.push(path.join(envPath, "Lib", "R", "bin", "R.exe"));
	}
	return paths;
}

export function getCondaName(homePath: string): string {
	const parts = homePath.split(path.sep); // Split path into components
	let targetIndex = -1;

	targetIndex = parts.lastIndexOf("Lib");

	// The Conda env name should be the directory before "Lib" or "bin"
	if (targetIndex > 0) {
		return parts[targetIndex - 1]; // Get the folder before "Lib" or "bin"
	}

	return ""; // Return empty if no valid Conda env name is found
}
