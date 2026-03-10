"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRPath = buildRPath;
exports.buildPythonPath = buildPythonPath;
exports.expectSessionStartToFail = expectSessionStartToFail;
const assert_1 = require("assert");
/**
 * Helper function to build R path based on environment.
 * Reads version from POSITRON_R_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'customRoot', 'exclude', or 'override'
 */
function buildRPath(usage = 'exclude') {
    const version = process.env.POSITRON_R_ALT_VER_SEL;
    if (!version) {
        throw new Error('Environment variable POSITRON_R_ALT_VER_SEL not set');
    }
    const majorMinor = version.split('.').slice(0, 2).join('.');
    if (usage === 'customRoot') {
        // Custom root - the custom folder for R discovery
        return process.env.CI
            ? '/root/scratch'
            : '/Users/runner/scratch'; // <-- modify for local testing
    }
    else if (usage === 'exclude') {
        // Exclude path - the standard R installation location for the version
        return process.env.CI
            ? `/opt/R/${version}`
            : `/Library/Frameworks/R.framework/Versions/${majorMinor}-arm64`; // <-- modify for local testing
    }
    else {
        // Override path - the hidden R interpreter location
        return process.env.CI
            ? `/root/scratch/r-env/bin/R`
            : `/Users/runner/scratch/r-env/bin/R`; // <-- modify for local testing
    }
}
/**
 * Helper function to build Python path based on environment.
 * Reads version from POSITRON_PY_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'include', 'exclude', or 'override'
 */
function buildPythonPath(usage = 'exclude') {
    const version = process.env.POSITRON_PY_ALT_VER_SEL;
    if (!version) {
        throw new Error('Environment variable POSITRON_PY_ALT_VER_SEL not set');
    }
    if (usage === 'include' || usage === 'override') {
        // Include and Override path - the hidden Python interpreter directory
        return process.env.CI
            ? '/root/scratch/python-env'
            : '/Users/runner/scratch/python-env'; // <-- modify for local testing
    }
    else {
        // Exclude path - the standard pyenv location for the version
        return process.env.CI
            ? `~/.pyenv`
            : `/Users/runner/.pyenv/versions/${version}`; // <-- modify for local testing
    }
}
/**
 * Helper function to verify that starting a session fails (e.g., when interpreter is excluded).
 * If the session starts successfully, the test will fail.
 */
async function expectSessionStartToFail(sessions, interpreterName, excludedPath) {
    let sessionStarted = false;
    try {
        await sessions.start(interpreterName, { reuse: false });
        sessionStarted = true;
    }
    catch (e) {
        // Expected - session should fail to start
    }
    if (sessionStarted) {
        (0, assert_1.fail)(`Expected interpreter to be excluded: ${excludedPath}`);
    }
}
//# sourceMappingURL=include-excludes.js.map