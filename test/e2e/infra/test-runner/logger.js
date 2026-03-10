"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
exports.createLogger = createLogger;
exports.logErrorToFile = logErrorToFile;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const mkdirp = require("mkdirp");
const infra_1 = require("../../infra");
const VERBOSE = process.env.VERBOSE === 'true';
/**
 * Create a logger instance.
 *
 * @param logsRootPath the root path for the logs
 * @returns Logger instance
 */
function createLogger(logsRootPath, logsFileName = 'e2e-test-runner.log') {
    const loggers = [];
    if (VERBOSE) {
        loggers.push(new infra_1.ConsoleLogger());
    }
    fs.rmSync(logsRootPath, { recursive: true, force: true, maxRetries: 3 });
    mkdirp.sync(logsRootPath);
    loggers.push(new infra_1.FileLogger(path.join(logsRootPath, logsFileName)));
    return new infra_1.MultiLogger(loggers);
}
/**
 * Logs a message to the file specified
 *
 * @param logFile the directory where the log file is saved
 * @param message the message to log
 */
function logToFile(logFilePath, message) {
    const logDir = path.dirname(logFilePath);
    // Ensure the directory exists
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    // Remove ANSI escape codes from the message
    const ansiRegex = /\u001b\[[0-9;]*m/g;
    const cleanMessage = message.replace(ansiRegex, '');
    try {
        fs.appendFileSync(logFilePath, cleanMessage + '\n', 'utf-8');
    }
    catch (err) {
        console.error(`Error writing log to ${logFilePath}: ${err.message}`);
    }
}
/**
 * Logs the error to the test log file: logs/e2e-tests-electron/<test-file-name>/retry.log
 *
 * @param test mocha test
 * @param err error
 */
function logErrorToFile(test, err) {
    const LOGS_ROOT_PATH = process.env.LOGS_ROOT_PATH || 'LOGS_ROOT_PATH not set logger';
    const fileName = path.basename(test.file);
    const testLogPath = path.join(LOGS_ROOT_PATH, fileName, 'retry.log');
    const title = `[RUN #${test.currentRetry()}] ${test.fullTitle()}`;
    const dashes = printDashes(title.length);
    const error = err.stack || err.message;
    logToFile(testLogPath, `${dashes}\n${title}\n${dashes}\n${error}\n`);
}
/**
 * Returns a string of dashes based on the length.
 *
 * @param length number of dashes to print
 * @returns string of dashes
 */
function printDashes(length) {
    const minLength = 45;
    return '-'.repeat(Math.max(length, minLength));
}
//# sourceMappingURL=logger.js.map