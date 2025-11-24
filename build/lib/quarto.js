"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuartoStream = getQuartoStream;
exports.getQuarto = getQuarto;
exports.getQuartoBinaries = getQuartoBinaries;
const fancy_log_1 = __importDefault(require("fancy-log"));
const fetch_1 = require("./fetch");
const es = __importStar(require("event-stream"));
const gulp = require("gulp");
const util = require("./util");
const rename = require("gulp-rename");
const path = require("path");
/**
 * Get the base URL for the quarto download
 *
 * @param version The version of quarto to download
 * @returns The base URL for the quarto download
 */
function getBaseUrl(version) {
    return `https://github.com/quarto-dev/quarto-cli/releases/download/v${version}/`;
}
/**
 * Gets a stream that downloads and unpacks the quarto executable for Windows
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoWindows(version) {
    const unzip = require('gulp-unzip');
    const basename = `quarto-${version}-win`;
    return (0, fetch_1.fetchUrls)([`${basename}.zip`], {
        base: getBaseUrl(version),
        verbose: true,
        timeoutSeconds: 90,
    })
        .pipe(unzip({ keepEmpty: true }));
}
/**
 * Gets a stream that downloads and unpacks the quarto executable for macOS
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoMacOS(version) {
    const gunzip = require('gulp-gunzip');
    const untar = require('gulp-untar');
    return (0, fetch_1.fetchUrls)([`quarto-${version}-macos.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
        timeoutSeconds: 90,
    })
        // Unzip, then untar
        .pipe(gunzip())
        .pipe(untar());
}
/**
 * Gets a stream that downloads and unpacks the quarto executable for Linux
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoLinux(version) {
    const gunzip = require('gulp-gunzip');
    const untar = require('gulp-untar');
    const rename = require('gulp-rename');
    const basename = process.env['npm_config_arch'] === 'x64' ?
        `quarto-${version}-linux-amd64` :
        `quarto-${version}-linux-arm64`;
    return (0, fetch_1.fetchUrls)([`${basename}.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
        timeoutSeconds: 90,
    })
        // Unzip, then untar
        .pipe(gunzip())
        .pipe(untar())
        // Remove the leading directory from the path
        .pipe(rename((path) => {
        if (path.dirname.startsWith(`quarto-${version}`)) {
            path.dirname = path.dirname.replace(/^quarto-[^/]+\/?/, '');
        }
    }));
}
/**
 * Gets a stream that downloads and unpacks the quarto executable. Reads
 * `npm_config_arch` to determine the architecture.
 *
 * @returns A stream that downloads and unpacks the quarto executable
 */
function getQuartoStream() {
    // quarto version
    const version = '1.7.32';
    (0, fancy_log_1.default)(`Synchronizing quarto ${version}...`);
    // Get the download/unpack stream for the current platform
    return process.platform === 'win32' ?
        getQuartoWindows(version) :
        process.platform === 'darwin' ?
            getQuartoMacOS(version) :
            getQuartoLinux(version);
}
/**
 * Standalone helper for downloading and unpacking quarto; downloads quarto to
 * thie `.build` folder for testing.
 *
 * @returns A promise that resolves when quarto is downloaded and unpacked
 */
function getQuarto() {
    const stream = getQuartoStream()
        .pipe(util.setExecutableBit())
        .pipe(gulp.dest('.build/quarto'));
    return new Promise((resolve, reject) => {
        es.merge([stream])
            .on('error', reject)
            .on('end', resolve);
    });
}
/**
 * Helper to package the quarto binaries into a `quarto` subdirectory with
 * the executable bit set.
 *
 * @returns A stream that provides the quarto binaries
 */
function getQuartoBinaries() {
    return getQuartoStream()
        // Move the Quarto binaries into a `quarto` subdirectory
        .pipe(rename(f => { f.dirname = path.join('quarto', f.dirname || ''); }))
        // Skip generated files that start with '._'
        .pipe(es.mapSync((f) => {
        if (!f.basename.startsWith('._')) {
            return f;
        }
    }))
        // Restore the executable bit on the Quarto binaries. (It's very
        // unfortunate that gulp doesn't preserve the executable bit when
        // copying files.)
        .pipe(util.setExecutableBit([
        '**/dart',
        '**/deno',
        '**/esbuild',
        '**/pandoc',
        '**/quarto',
        '**/sass',
        '**/typst'
    ]));
}
if (require.main === module) {
    getQuarto().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=quarto.js.map