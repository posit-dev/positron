"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositWorkbench = void 0;
const workbench_1 = require("./workbench");
const dashboard_page_js_1 = require("../pages/workbench/dashboard.page.js");
const auth_page_js_1 = require("../pages/workbench/auth.page.js");
class PositWorkbench extends workbench_1.Workbench {
    auth;
    dashboard;
    constructor(code) {
        // Initialize the base workbench with all standard Positron pages
        super(code);
        // Add workbench specific pages
        this.auth = new auth_page_js_1.AuthPage(code);
        this.dashboard = new dashboard_page_js_1.DashboardPage(code, this.quickInput);
    }
}
exports.PositWorkbench = PositWorkbench;
//# sourceMappingURL=workbench-pwb.js.map