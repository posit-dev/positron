/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from 'path';
import { RMetadataExtra } from './r-installation';

/**
 * The kind of mutation to apply to a terminal environment variable. Mirrors the
 * `replace`/`prepend`/`append` methods on VS Code's
 * `EnvironmentVariableCollection`.
 */
export type TerminalEnvironmentAction = 'replace' | 'prepend' | 'append';

/**
 * A single mutation to apply to the contributed terminal environment.
 */
export interface TerminalEnvironmentMutation {
	readonly action: TerminalEnvironmentAction;
	readonly variable: string;
	readonly value: string;
}

/**
 * Compute the terminal environment variable mutations that make a terminal use
 * the same R installation as the active console.
 *
 * Several extensions (Quarto Preview, Shiny Run App, etc.) start R in a terminal
 * to perform background tasks. Without these mutations, those tasks run against
 * the system default R rather than the version selected in Positron's console.
 *
 * When multiple consoles run different R versions, whichever is activated last
 * wins; this ambiguity is expected and acceptable (see
 * https://github.com/posit-dev/positron/issues/7403).
 *
 * @param metadataExtra Extra metadata for the active R installation.
 * @param platform The platform to compute mutations for. Defaults to the
 *   current platform; overridable for testing.
 * @returns The mutations to apply to the terminal environment collection.
 */
export function getRTerminalEnvironmentMutations(
	metadataExtra: RMetadataExtra,
	platform: NodeJS.Platform = process.platform
): TerminalEnvironmentMutation[] {
	const mutations: TerminalEnvironmentMutation[] = [];
	const pathSeparator = platform === 'win32' ? ';' : ':';

	// Prepend the directory containing the selected R binary to PATH so that
	// `R`, `Rscript`, and tools that shell out to them resolve to the version
	// selected in the console rather than the system default. This is the
	// primary mechanism by which the terminal's R matches the console's R, and
	// mirrors how rig makes a selected R version available (symlinks on PATH).
	if (metadataExtra.binpath) {
		mutations.push({
			action: 'prepend',
			variable: 'PATH',
			value: dirname(metadataExtra.binpath) + pathSeparator,
		});
	}

	// Set R_HOME so tools that read it (rather than deriving it from the R
	// binary) find the selected installation. R_HOME is R-specific, so setting
	// it in the terminal does not affect unrelated programs.
	if (metadataExtra.homepath) {
		mutations.push({
			action: 'replace',
			variable: 'R_HOME',
			value: metadataExtra.homepath,
		});
	}

	// Point QUARTO_R at the directory containing Rscript so that `quarto render`
	// (and the bundled Quarto extension) use the selected R version. Note that
	// `scriptpath` is the full path to the Rscript binary (foo/bar/Rscript), but
	// Quarto expects the directory (foo/bar).
	if (metadataExtra.scriptpath) {
		mutations.push({
			action: 'replace',
			variable: 'QUARTO_R',
			value: dirname(metadataExtra.scriptpath),
		});
	}

	// We intentionally do NOT set DYLD_LIBRARY_PATH (macOS) or LD_LIBRARY_PATH
	// (Linux) here, even though the Ark kernel sets them. Those variables affect
	// dynamic linking for *every* program run in the terminal, not just R, and
	// can cause unrelated tools to load R's bundled copies of common libraries
	// (libcurl, libz, etc.). R's own launcher scripts (`R`/`Rscript`) already
	// configure their library paths, so the variables are unnecessary for R to
	// work from the terminal. This mirrors rig, which scopes DYLD_LIBRARY_PATH to
	// R's launcher script rather than exporting it to the shell. Ark needs the
	// variables because it is a compiled binary that loads libR directly,
	// bypassing the launcher scripts.

	return mutations;
}
