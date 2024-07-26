"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuartoStream = getQuartoStream;
exports.getQuarto = getQuarto;
const fancyLog = require("fancy-log");
const fetch_1 = require("./fetch");
const es = require("event-stream");
const gulp = require("gulp");
const util = require("./util");
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
    })
        .pipe(unzip());
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
    const flatmap = require('gulp-flatmap');
    return (0, fetch_1.fetchUrls)([`quarto-${version}-macos.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        // Unzip, then untar
        .pipe(flatmap((stream) => stream.pipe(gunzip()).pipe(untar())));
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
    const flatmap = require('gulp-flatmap');
    const basename = process.env['npm_config_arch'] === 'x64' ?
        `quarto-${version}-linux-amd64` :
        `quarto-${version}-linux-arm64`;
    return (0, fetch_1.fetchUrls)([`${basename}.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        // Unzip, then untar
        .pipe(flatmap((stream) => stream.pipe(gunzip()).pipe(untar())));
}
/**
 * Gets a stream that downloads and unpacks the quarto executable. Reads
 * `npm_config_arch` to determine the architecture.
 *
 * @returns A stream that downloads and unpacks the quarto executable
 */
function getQuartoStream() {
    // quarto version
    const version = '1.5.55';
    fancyLog(`Synchronizing quarto ${version}...`);
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
if (require.main === module) {
    getQuarto().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=quarto.js.map