"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuildVersion = exports.getBuildElectronPath = exports.getDevElectronPath = void 0;
__exportStar(require("./application"), exports);
__exportStar(require("./code"), exports);
__exportStar(require("./logger"), exports);
__exportStar(require("./workbench"), exports);
__exportStar(require("./test-runner"), exports);
__exportStar(require("./test-teardown.js"), exports);
__exportStar(require("./systemDiagnostics"), exports);
// pages
__exportStar(require("../pages/console"), exports);
__exportStar(require("../pages/dialog-modals"), exports);
__exportStar(require("../pages/dialog-toasts"), exports);
__exportStar(require("../pages/dialog-popups.js"), exports);
__exportStar(require("../pages/variables"), exports);
__exportStar(require("../pages/dataExplorer"), exports);
__exportStar(require("../pages/sideBar"), exports);
__exportStar(require("../pages/plots"), exports);
__exportStar(require("../pages/notebooks"), exports);
__exportStar(require("../pages/notebooksVscode"), exports);
__exportStar(require("../pages/notebooksPositron"), exports);
__exportStar(require("../pages/newFolderFlow"), exports);
__exportStar(require("../pages/connections"), exports);
__exportStar(require("../pages/help"), exports);
__exportStar(require("../pages/output"), exports);
__exportStar(require("../pages/welcome"), exports);
__exportStar(require("../pages/topActionBar"), exports);
__exportStar(require("../pages/layouts"), exports);
__exportStar(require("../pages/terminal"), exports);
__exportStar(require("../pages/viewer"), exports);
__exportStar(require("../pages/editor"), exports);
__exportStar(require("../pages/testExplorer"), exports);
__exportStar(require("../pages/explorer"), exports);
__exportStar(require("../pages/quickaccess"), exports);
__exportStar(require("../pages/outline"), exports);
__exportStar(require("../pages/clipboard"), exports);
__exportStar(require("../pages/extensions"), exports);
__exportStar(require("../pages/editors"), exports);
__exportStar(require("../pages/userSettings"), exports);
__exportStar(require("../pages/debug"), exports);
__exportStar(require("../pages/problems"), exports);
__exportStar(require("../pages/references"), exports);
__exportStar(require("../pages/scm"), exports);
__exportStar(require("../pages/sessions"), exports);
__exportStar(require("../pages/hotKeys"), exports);
__exportStar(require("../pages/positronAssistant"), exports);
__exportStar(require("../pages/databot"), exports);
// utils
__exportStar(require("../pages/utils/aws"), exports);
__exportStar(require("../pages/dialog-contextMenu"), exports);
__exportStar(require("../pages/utils/settingsFile"), exports);
__exportStar(require("../pages/utils/storageFile"), exports);
var electron_1 = require("./electron");
Object.defineProperty(exports, "getDevElectronPath", { enumerable: true, get: function () { return electron_1.getDevElectronPath; } });
Object.defineProperty(exports, "getBuildElectronPath", { enumerable: true, get: function () { return electron_1.getBuildElectronPath; } });
Object.defineProperty(exports, "getBuildVersion", { enumerable: true, get: function () { return electron_1.getBuildVersion; } });
//# sourceMappingURL=index.js.map