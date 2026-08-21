/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { posix, win32 } from 'path';
import { LOGGER } from './extension';
import { RMetadataExtra } from './r-installation';
import { EnvVar, RSession, getEnvVars } from './session';
import { prepCliEnvVars } from './uri-handler';

/**
 * How a value combines with any existing value. These are the names of the
 * `replace`/`prepend`/`append` methods on VS Code's
 * `EnvironmentVariableCollection`.
 */
type EnvVarAction = 'replace' | 'prepend' | 'append';

/**
 * A single mutation to an environment variable.
 *
 * Deliberately the same shape as `CapturedEnvironmentVariable`, which the
 * positron-environment-modules extension publishes and provider-module.ts
 * mirrors locally. That lets module-captured variables and the mutations
 * computed below share the appliers with no conversion.
 */
export interface EnvVarMutation {
	readonly name: string;
	readonly value: string;
	readonly action: EnvVarAction;
}

/**
 * Compute the terminal environment variable mutations that make a terminal use
 * the same R installation as the active console.
 *
 * Extension features such as Quarto's preview and Shiny's Run App start R in a
 * terminal to do background work. Without these mutations, that work runs
 * against the system default R rather than the version selected in the console.
 *
 * @param metadataExtra Extra metadata for the active R installation.
 * @param platform The platform to compute mutations for. Defaults to the
 *   current platform; overridable for testing.
 * @returns The mutations to apply to the terminal environment collection.
 */
export function getRTerminalEnvironmentMutations(
	metadataExtra: RMetadataExtra,
	platform: NodeJS.Platform = process.platform
): EnvVarMutation[] {
	const mutations: EnvVarMutation[] = [];
	// Parse paths with the flavor matching the target platform, not the host
	// running this code, so that Windows backslash paths are handled correctly
	// even when computing mutations on a posix host (e.g. in tests).
	const path = platform === 'win32' ? win32 : posix;
	const pathSeparator = platform === 'win32' ? ';' : ':';

	// Prepend the directory containing the selected R binary to PATH so that
	// `R`, `Rscript`, and tools that shell out to them resolve to the version
	// selected in the console rather than the system default. This is the
	// primary mechanism by which the terminal's R matches the console's R, and
	// mirrors how rig makes a selected R version available (symlinks on PATH).
	if (metadataExtra.binpath) {
		mutations.push({
			action: 'prepend',
			name: 'PATH',
			value: path.dirname(metadataExtra.binpath) + pathSeparator,
		});
	}

	// We do not set R_HOME here: R's launcher scripts (`R`/`Rscript`) derive it
	// themselves from their own location, so once PATH points at the selected R,
	// R_HOME is redundant.

	// Point QUARTO_R at the directory containing Rscript so that `quarto render`
	// (and the bundled Quarto extension) use the selected R version. Note that
	// `scriptpath` is the full path to the Rscript binary (foo/bar/Rscript), but
	// Quarto expects the directory (foo/bar).
	if (metadataExtra.scriptpath) {
		mutations.push({
			action: 'replace',
			name: 'QUARTO_R',
			value: path.dirname(metadataExtra.scriptpath),
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

/**
 * Apply mutations to a terminal environment variable collection.
 *
 * @param collection The collection to mutate.
 * @param mutations The mutations to apply.
 * @param options Controls whether the variables reach process creation, shell
 *   integration, or both.
 */
export function applyMutationsToCollection(
	collection: vscode.EnvironmentVariableCollection,
	mutations: readonly EnvVarMutation[],
	options: vscode.EnvironmentVariableMutatorOptions
): void {
	for (const mutation of mutations) {
		// Skip variables that already hold the desired value, to avoid
		// needlessly marking open terminals as stale.
		if (collection.get(mutation.name)?.value === mutation.value) {
			continue;
		}
		switch (mutation.action) {
			case 'replace':
				collection.replace(mutation.name, mutation.value, options);
				break;
			case 'prepend':
				collection.prepend(mutation.name, mutation.value, options);
				break;
			case 'append':
				collection.append(mutation.name, mutation.value, options);
				break;
			default: {
				const unhandled: never = mutation.action;
				LOGGER.error(`Unhandled environment variable action ${unhandled} for ${mutation.name}`);
				break;
			}
		}
		LOGGER.debug(`Updated terminal environment variable ${mutation.name} (${mutation.action}) to ${mutation.value}`);
	}
}

/**
 * Apply mutations to a process environment, in place.
 *
 * Prepend and append concatenate directly: the mutation's value carries any
 * separator it needs.
 *
 * Mirrors applyToProcessEnvironment in environmentVariableCollection.ts, minus
 * the parts that don't apply here: we get a flat, already-filtered list from
 * getEnvironmentContributions, so there are no scopes, no per-variable mutator
 * stacks, and no Python activation filtering.
 *
 * @param env The environment to mutate.
 * @param mutations The mutations to apply.
 */
function applyMutationsToProcessEnv(
	env: NodeJS.ProcessEnv,
	mutations: readonly EnvVarMutation[]
): void {
	// Windows environment variable names are case-insensitive, but a plain object
	// copy of process.env is not: the copy can hold `Path` while a contribution
	// names `PATH`. Writing the contributed spelling would hand the child both
	// names, so map onto the spelling the environment already uses.
	const actualNames = new Map<string, string>();
	if (process.platform === 'win32') {
		for (const name of Object.keys(env)) {
			actualNames.set(name.toLowerCase(), name);
		}
	}

	for (const mutation of mutations) {
		const name = actualNames.get(mutation.name.toLowerCase()) ?? mutation.name;
		switch (mutation.action) {
			case 'replace':
				env[name] = mutation.value;
				break;
			case 'prepend':
				env[name] = mutation.value + (env[name] ?? '');
				break;
			case 'append':
				env[name] = (env[name] ?? '') + mutation.value;
				break;
			default: {
				const unhandled: never = mutation.action;
				LOGGER.error(`Unhandled environment variable action ${unhandled} for ${name}`);
				break;
			}
		}
	}
}

function toEnvVarAction(type: vscode.EnvironmentVariableMutatorType): EnvVarAction | undefined {
	switch (type) {
		case vscode.EnvironmentVariableMutatorType.Replace:
			return 'replace';
		case vscode.EnvironmentVariableMutatorType.Prepend:
			return 'prepend';
		case vscode.EnvironmentVariableMutatorType.Append:
			return 'append';
		default:
			return undefined;
	}
}

/**
 * The environment variable contributions of every extension, as mutations.
 *
 * These are what a terminal gets from core and a kernel gets from the
 * supervisor: RSTUDIO_PANDOC from positron-environment, PATH and QUARTO_R from
 * this extension, JUPYTER_PATH so Quarto can find the bundled ark kernel, plus
 * anything the user configured. Contributions that opt out of process creation
 * are already excluded upstream (see mainThreadEnvironment.ts), which is how
 * module environments stay terminal-only.
 *
 * Extensions are visited in an unspecified order, so when several contribute to
 * the same variable (three prepend to PATH today) the order they land in is not
 * defined. This matches what a terminal gets, which is the point.
 *
 * The supervisor does the equivalent translation for kernels in
 * KallichoreSession.ts. Extensions can't share code, so the two are duplicates
 * that have to be kept in step by hand.
 *
 * @returns The contributed mutations, in no particular order.
 */
async function getContributedMutations(): Promise<EnvVarMutation[]> {
	const contributions = await positron.environment.getEnvironmentContributions();
	const mutations: EnvVarMutation[] = [];
	for (const [extensionId, actions] of Object.entries(contributions)) {
		for (const action of actions) {
			const mutationAction = toEnvVarAction(action.action);
			if (mutationAction === undefined) {
				LOGGER.warn(
					`Ignoring environment variable ${action.name} contributed by ${extensionId}: ` +
					`unknown action ${action.action}`
				);
				continue;
			}
			mutations.push({ action: mutationAction, name: action.name, value: action.value });
		}
	}
	return mutations;
}

/**
 * Environment variables read from the R console session and forwarded to the R
 * processes that run package tests: the "Test R Package in Terminal" task and
 * the test explorer's runner. The other package tasks do not get these. This is
 * the authoritative list; add to it here rather than at a call site.
 */
const FORWARDED_R_SESSION_ENV_VARS = [
	// https://github.com/posit-dev/positron/pull/2488
	// On macOS, a bare spawn() from the extension host has no LANG, so R falls
	// back to the C locale. This can cause spurious failure of locale-sensitive
	// tests. This only affects the test explorer and not the "Test R Package in
	// Terminal" command. However, it should be neutral-to-positive everywhere
	// and it's cleaner to always forward the same env vars.
	'LANG',
	// testthat gives up after this many failures. A user who raised the limit
	// in the console expects the same limit when Positron runs their tests.
	'TESTTHAT_MAX_FAILS',
];

/**
 * Read {@link FORWARDED_R_SESSION_ENV_VARS} from an R session.
 *
 * @param session The R session to read from. Defaults to the console session.
 * @returns The variables that are actually set in that session.
 */
export async function getForwardedSessionEnvVars(session?: RSession): Promise<EnvVar> {
	const envVars = await getEnvVars(FORWARDED_R_SESSION_ENV_VARS, session);
	// Sys.getenv() reports an unset variable as "", so drop empties rather than
	// passing an empty value along as if the user had set one.
	return Object.fromEntries(
		Object.entries(envVars).filter(([, value]) => value !== '')
	);
}

/**
 * Build the environment for an R process that Positron launches outside of a
 * terminal, such as the test explorer's test runner.
 *
 * A terminal (and therefore an R package task) gets the contributed environment
 * from core, and a kernel gets it from the supervisor. A directly spawned
 * process gets nothing, so we assemble the same layers here: the extension host
 * environment, the contributions, and the variables that come from the R
 * console session itself.
 *
 * @returns The environment to spawn with.
 */
export async function buildRProcessEnv(): Promise<NodeJS.ProcessEnv> {
	const env: NodeJS.ProcessEnv = { ...process.env };

	applyMutationsToProcessEnv(env, await getContributedMutations());

	Object.assign(
		env,
		await getForwardedSessionEnvVars(),
		await prepCliEnvVars()
	);

	return env;
}
