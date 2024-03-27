"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPandoc = exports.getPandocStream = void 0;
const fancyLog = require("fancy-log");
const fetch_1 = require("./fetch");
const es = require("event-stream");
const filter = require("gulp-filter");
const gulp = require("gulp");
const util = require("./util");
/**
 * Get the base URL for the pandoc download
 *
 * @param version The version of pandoc to download
 * @returns The base URL for the pandoc download
 */
function getBaseUrl(version) {
    return `https://github.com/jgm/pandoc/releases/download/${version}/`;
}
/**
 * Gets a stream that downloads and unpacks the pandoc executable for Windows
 *
 * @param version The version of pandoc to download
 * @returns A stream
 */
function getPandocWindows(version) {
    const unzip = require('gulp-unzip');
    const basename = `pandoc-${version}-windows-x86_64`;
    const rename = require('gulp-rename');
    return (0, fetch_1.fetchUrls)([`${basename}.zip`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        .pipe(unzip({
        // Extract only the pandoc executable
        filter: (entry) => entry.path.endsWith('.exe')
    }))
        .pipe(rename(`pandoc.exe`));
}
/**
 * Gets a stream that downloads and unpacks the pandoc executable for macOS
 *
 * @param version The version of pandoc to download
 * @returns A stream
 */
function getPandocMacOS(version) {
    const unzip = require('gulp-unzip');
    const rename = require('gulp-rename');
    // Get the pandoc architecture for the current platform we're building. Note
    // that this may differ from the machine's architecture since we may be
    // cross-compiling Positron for a different platform.
    const basename = process.env['npm_config_arch'] === 'x64' ?
        `pandoc-${version}-x86_64-macOS` :
        `pandoc-${version}-arm64-macOS`;
    return (0, fetch_1.fetchUrls)([`${basename}.zip`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        .pipe(unzip({
        // Extract only the pandoc executable
        filter: (entry) => entry.path.endsWith('pandoc')
    }))
        .pipe(rename(`pandoc`));
}
/**
 * Gets a stream that downloads and unpacks the pandoc executable for Linux
 *
 * @param version The version of pandoc to download
 * @returns A stream
 */
function getPandocLinux(version) {
    // Linux requires gunzip and untar
    const gunzip = require('gulp-gunzip');
    const untar = require('gulp-untar');
    const flatmap = require('gulp-flatmap');
    const rename = require('gulp-rename');
    const basename = process.env['npm_config_arch'] === 'x64' ?
        `pandoc-${version}-linux-amd64` :
        `pandoc-${version}-linux-arm64`;
    return (0, fetch_1.fetchUrls)([`${basename}.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        // Unzip, then untar
        .pipe(flatmap((stream) => stream.pipe(gunzip()).pipe(untar())))
        // Extract only the pandoc executable
        .pipe(filter('**/pandoc'))
        .pipe(rename(`pandoc`));
}
/**
 * Gets a stream that downloads and unpacks the pandoc executable. Reads
 * `npm_config_arch` to determine the architecture.
 *
 * @returns A stream that downloads and unpacks the pandoc executable
 */
function getPandocStream() {
    // Pandoc version
    const version = '3.1.12.3';
    fancyLog(`Synchronizing Pandoc ${version}...`);
    // Get the download/unpack stream for the current platform
    return process.platform === 'win32' ?
        getPandocWindows(version) :
        process.platform === 'darwin' ?
            getPandocMacOS(version) :
            getPandocLinux(version);
}
exports.getPandocStream = getPandocStream;
/**
 * Standalone helper for downloading and unpacking pandoc; downloads Pandoc to
 * thie `.build` folder for testing.
 *
 * @returns A promise that resolves when pandoc is downloaded and unpacked
 */
function getPandoc() {
    const stream = getPandocStream()
        .pipe(util.setExecutableBit())
        .pipe(gulp.dest('.build/pandoc'));
    return new Promise((resolve, reject) => {
        es.merge([stream])
            .on('error', reject)
            .on('end', resolve);
    });
}
exports.getPandoc = getPandoc;
if (require.main === module) {
    getPandoc().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=pandoc.js.map