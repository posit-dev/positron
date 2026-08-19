/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which package index a Python environment installs from.
 *
 * Positron asks for this to decide which Posit Package Manager instance, if any,
 * can report security advisories for the installed packages. The resolution
 * lives here because it follows pip's and uv's own precedence, including
 * `pip config`, which needs the environment's interpreter to evaluate.
 */

/** The index environment variables pip honours. uv does not read pip's. */
export const PIP_INDEX_ENV_VARS: readonly string[] = ['PIP_INDEX_URL'];

/**
 * The index environment variables uv honours, in uv's own precedence:
 * `UV_DEFAULT_INDEX` first, then its deprecated predecessor `UV_INDEX_URL`.
 * uv does not read `PIP_INDEX_URL`.
 */
export const UV_INDEX_ENV_VARS: readonly string[] = ['UV_DEFAULT_INDEX', 'UV_INDEX_URL'];

/**
 * Resolve the index URL the environment's installer would use, from the sources
 * available without kernel involvement: the installer's own environment
 * variables, then `pip config get global.index-url` (which reads pip's own
 * config-file precedence, covering `/etc/pip.conf` and per-user and
 * per-environment files) via the caller-supplied lookup.
 *
 * @param envVars The index environment variables the calling package manager
 *   itself honours, in its own precedence order ({@link PIP_INDEX_ENV_VARS} or
 *   {@link UV_INDEX_ENV_VARS}). pip and uv read different variables, so one
 *   shared list would resolve an index the environment never installs from --
 *   and hand the installed-package inventory to a host the environment has no
 *   relationship with.
 * @param getPipConfigIndexUrl Optional callback that runs `pip config get
 *   global.index-url` in the environment and returns its output, or undefined
 *   when unset. Injectable so uv (which doesn't read pip config) can omit it and
 *   tests can fake it.
 * @param env Process environment, injectable for tests.
 * @returns The index URL, or undefined when only the default (pypi.org, not a
 *   PPM) applies.
 */
export async function resolvePythonIndexUrl(
    envVars: readonly string[],
    getPipConfigIndexUrl?: () => Promise<string | undefined>,
    env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
    // pip precedence is command line > environment > config files; the command
    // line isn't visible here, so the environment comes first.
    for (const name of envVars) {
        const value = env[name]?.trim();
        if (value) {
            return stripTrailingSlash(value);
        }
    }

    if (getPipConfigIndexUrl) {
        try {
            const fromConfig = (await getPipConfigIndexUrl())?.trim();
            if (fromConfig) {
                return stripTrailingSlash(fromConfig);
            }
        } catch {
            // `pip config get` exits non-zero when the key is unset; treat any
            // failure as "no configured index".
        }
    }

    return undefined;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
