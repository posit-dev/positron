"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiLogger = exports.FileLogger = exports.ConsoleLogger = void 0;
exports.measureAndLog = measureAndLog;
const fs_1 = require("fs");
const util_1 = require("util");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
class ConsoleLogger {
    log(message, ...args) {
        console.log('**', message, ...args);
    }
}
exports.ConsoleLogger = ConsoleLogger;
class FileLogger {
    path;
    constructor(initialPath) {
        this.path = initialPath;
        this.ensureFileExists(this.path);
    }
    setPath(dir, filename = 'e2e-test-runner.log') {
        this.path = path_1.default.join(dir, filename);
        this.ensureFileExists(this.path);
    }
    ensureFileExists(path) {
        if (!(0, fs_1.existsSync)(path)) {
            (0, fs_1.writeFileSync)(path, '');
        }
    }
    log(message, ...args) {
        const date = new Date().toISOString();
        const formattedMessage = `[${date}] ${(0, util_1.format)(message, ...args)}${os_1.EOL}`;
        try {
            (0, fs_1.appendFileSync)(this.path, formattedMessage);
        }
        catch (error) {
            console.log('FileLogger error, falling back to console:', formattedMessage.trim(), error);
        }
    }
}
exports.FileLogger = FileLogger;
class MultiLogger {
    loggers;
    constructor(loggers) {
        this.loggers = loggers;
    }
    setPath(dir, filename = 'e2e-test-runner.log') {
        for (const logger of this.loggers) {
            if (logger.setPath) {
                logger.setPath(dir, filename);
            }
        }
    }
    log(message, ...args) {
        for (const logger of this.loggers) {
            logger.log(message, ...args);
        }
    }
}
exports.MultiLogger = MultiLogger;
async function measureAndLog(promiseFactory, name, logger) {
    const now = Date.now();
    logger.log(`Starting operation '${name}'...`);
    let res = undefined;
    let e;
    try {
        res = await promiseFactory();
    }
    catch (error) {
        e = error;
    }
    if (e) {
        logger.log(`Finished operation '${name}' with error ${e} after ${Date.now() - now}ms`);
        throw e;
    }
    logger.log(`Finished operation '${name}' successfully after ${Date.now() - now}ms`);
    return res;
}
//# sourceMappingURL=logger.js.map