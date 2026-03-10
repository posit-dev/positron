"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixtureScreenshot = exports.SPEC_NAME = exports.LOGS_ROOT_PATH = exports.ROOT_PATH = exports.TEMP_DIR = void 0;
exports.setSpecName = setSpecName;
exports.setFixtureScreenshot = setFixtureScreenshot;
const path_1 = require("path");
const crypto_1 = require("crypto");
// Constants used across test fixtures
exports.TEMP_DIR = `temp-${(0, crypto_1.randomUUID)()}`;
exports.ROOT_PATH = process.cwd();
exports.LOGS_ROOT_PATH = (0, path_1.join)(exports.ROOT_PATH, 'test-logs');
// Global state variables that need to be mutable
exports.SPEC_NAME = '';
function setSpecName(name) {
    exports.SPEC_NAME = name;
}
function setFixtureScreenshot(screenshot) {
    exports.fixtureScreenshot = screenshot;
}
//# sourceMappingURL=constants.js.map