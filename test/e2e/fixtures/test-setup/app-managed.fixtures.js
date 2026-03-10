"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManagedApp = ManagedApp;
const infra_1 = require("../../infra");
/**
 * Managed Positron app (Electron or browser-based)
 * Projects: e2e-electron, e2e-chromium/firefox/webkit/edge (port 9000)
 */
async function ManagedApp(fixtureOptions) {
    const { options } = fixtureOptions;
    const app = (0, infra_1.createApp)(options);
    const start = async () => {
        await app.start();
        await app.workbench.sessions.expectNoStartUpMessaging();
    };
    const stop = async () => {
        await app.stop();
    };
    return { app, start, stop };
}
//# sourceMappingURL=app-managed.fixtures.js.map