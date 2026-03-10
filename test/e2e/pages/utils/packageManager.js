"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageManager = void 0;
const test_1 = __importStar(require("@playwright/test"));
const Packages = [
    { name: 'renv', type: 'R' },
    { name: 'snowflake', type: 'Python' }
];
class PackageManager {
    app;
    constructor(app) {
        this.app = app;
    }
    /**
     * Manages the installation or uninstallation of a package.
     * @param packageName The name of the package (e.g., ipykernel or renv).
     * @param action The action to perform ('install' or 'uninstall').
     */
    async manage(packageName, action) {
        const packageInfo = Packages.find(pkg => pkg.name === packageName);
        if (!packageInfo) {
            throw new Error(`Package ${packageName} not found`);
        }
        await test_1.default.step(`${action}: ${packageName}`, async () => {
            const command = this.getCommand(packageInfo.type, packageName, action);
            const expectedOutput = this.getExpectedOutput(packageName, action);
            await this.app.workbench.console.executeCode(packageInfo.type, command);
            await (0, test_1.expect)(this.app.code.driver.currentPage.getByText(expectedOutput)).toBeVisible();
        });
    }
    /**
     * Returns the command for the specified action.
     * @param language The language associated with the package ('R' or 'Python').
     * @param packageName The name of the package.
     * @param action The action to perform ('install' or 'uninstall').
     */
    getCommand(language, packageName, action) {
        if (language === 'Python') {
            return action === 'install'
                ? `pip install ${packageName}`
                : `pip uninstall -y ${packageName}`;
        }
        else {
            return action === 'install'
                ? `install.packages("${packageName}", repos = "https://packagemanager.posit.co/cran/latest")`
                : `remove.packages("${packageName}")`;
        }
    }
    /**
     * Returns the expected console output for the specified action.
     * @param packageName The name of the package.
     * @param action The action to perform ('install' or 'uninstall').
     */
    getExpectedOutput(packageName, action) {
        switch (packageName) {
            case 'snowflake':
                return /you may need to restart the kernel to use updated packages/;
            default:
                return action === 'install' ? /Installing|Downloading|Fetched/ : /Removing|Uninstalling/;
        }
    }
}
exports.PackageManager = PackageManager;
//# sourceMappingURL=packageManager.js.map