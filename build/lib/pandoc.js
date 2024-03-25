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
function getBaseUrl(version) {
    return `https://github.com/jgm/pandoc/releases/download/${version}/`;
}
function getPandocWindows(version) {
    const unzip = require('gulp-unzip');
    const basename = `pandoc-${version}-windows-x86_64`;
    const rename = require('gulp-rename');
    return (0, fetch_1.fetchUrls)([`${basename}.zip`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        .pipe(unzip({
        filter: (entry) => entry.path.endsWith('.exe')
    }))
        .pipe(rename(`pandoc.exe`));
}
function getPandocMacOS(version) {
    const unzip = require('gulp-unzip');
    const rename = require('gulp-rename');
    const basename = process.arch === 'x64' ?
        `pandoc-${version}-x86_64-macOS` :
        `pandoc-${version}-arm64-macOS`;
    return (0, fetch_1.fetchUrls)([`${basename}.zip`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        .pipe(unzip({
        filter: (entry) => entry.path.endsWith('pandoc')
    }))
        .pipe(rename(`pandoc`));
}
function getPandocLinux(version) {
    const gunzip = require('gulp-gunzip');
    const untar = require('gulp-untar');
    const flatmap = require('gulp-flatmap');
    const rename = require('gulp-rename');
    const basename = process.arch === 'x64' ?
        `pandoc-${version}-linux-amd64` :
        `pandoc-${version}-linux-arm64`;
    return (0, fetch_1.fetchUrls)([`${basename}.tar.gz`], {
        base: getBaseUrl(version),
        verbose: true,
    })
        .pipe(flatmap((stream) => stream.pipe(gunzip()).pipe(untar())))
        .pipe(filter('**/pandoc'))
        .pipe(rename(`pandoc`));
}
function getPandocStream() {
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
function getPandoc() {
    const stream = getPandocStream();
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