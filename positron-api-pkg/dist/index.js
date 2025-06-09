"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewUrl = exports.inPositron = exports.tryAcquirePositronApi = void 0;
// Re-export the runtime function and types from the runtime module
var runtime_1 = require("./runtime");
Object.defineProperty(exports, "tryAcquirePositronApi", { enumerable: true, get: function () { return runtime_1.tryAcquirePositronApi; } });
Object.defineProperty(exports, "inPositron", { enumerable: true, get: function () { return runtime_1.inPositron; } });
// Re-export preview functions
var preview_1 = require("./preview");
Object.defineProperty(exports, "previewUrl", { enumerable: true, get: function () { return preview_1.previewUrl; } });
