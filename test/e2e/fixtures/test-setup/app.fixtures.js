"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserDataDirFixture = exports.OptionsFixture = void 0;
exports.AppFixture = AppFixture;
const app_managed_fixtures_1 = require("./app-managed.fixtures");
const app_external_fixtures_1 = require("./app-external.fixtures");
const app_workbench_fixtures_1 = require("./app-workbench.fixtures");
/**
 * Main app fixture that routes to the appropriate implementation based on configuration
 */
async function AppFixture(fixtureOptions) {
    const project = fixtureOptions.workerInfo.project.name;
    if (project === 'e2e-workbench') {
        return await (0, app_workbench_fixtures_1.WorkbenchApp)(fixtureOptions);
    }
    else if (project.includes('server')) {
        return await (0, app_external_fixtures_1.ExternalPositronServerApp)(fixtureOptions);
    }
    else {
        return await (0, app_managed_fixtures_1.ManagedApp)(fixtureOptions);
    }
}
// Re-export the options fixtures for convenience
var options_fixtures_1 = require("./options.fixtures");
Object.defineProperty(exports, "OptionsFixture", { enumerable: true, get: function () { return options_fixtures_1.OptionsFixture; } });
Object.defineProperty(exports, "UserDataDirFixture", { enumerable: true, get: function () { return options_fixtures_1.UserDataDirFixture; } });
//# sourceMappingURL=app.fixtures.js.map