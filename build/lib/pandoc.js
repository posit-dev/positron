"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPandoc = void 0;
const fancyLog = require("fancy-log");
const fetch_1 = require("./fetch");
const es = require("event-stream");
const gulp = require("gulp");
function getPandoc() {
    const unzip = require('gulp-unzip');
    const version = '3.1.12.3';
    fancyLog(`Synchronizing Pandoc ${version}...`);
    const base = `https://github.com/jgm/pandoc/releases/download/${version}/`;
    const filename = `pandoc-${version}-arm64-macOS.zip`;
    const stream = (0, fetch_1.fetchUrls)([filename], {
        base,
        verbose: true,
    })
        .pipe(unzip())
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