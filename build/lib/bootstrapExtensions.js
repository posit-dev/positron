"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBootstrapExtensionStream = getBootstrapExtensionStream;
exports.getBootstrapExtensions = getBootstrapExtensions;
const fs = require("fs");
const path = require("path");
const os = require("os");
const rimraf = require("rimraf");
const es = require("event-stream");
const rename = require("gulp-rename");
const vfs = require("vinyl-fs");
const ext = require("./extensions");
const fancyLog = require("fancy-log");
const ansiColors = require("ansi-colors");
const root = path.dirname(path.dirname(__dirname));
const productjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BOOTSTRAP_EXTENSIONS_SILENCE_PLEASE'];
const bootstrapExtensions = productjson.bootstrapExtensions || [];
const controlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'bootstrap-control.json');
function log(...messages) {
    if (ENABLE_LOGGING) {
        fancyLog(...messages);
    }
}
function getExtensionPath(extension) {
    return path.join(root, '.build', 'bootstrapExtensions', extension.name);
}
function isUpToDate(extension) {
    const packagePath = path.join(getExtensionPath(extension), 'package.json');
    if (!fs.existsSync(packagePath)) {
        return false;
    }
    const packageContents = fs.readFileSync(packagePath, { encoding: 'utf8' });
    try {
        const diskVersion = JSON.parse(packageContents).version;
        return (diskVersion === extension.version);
    }
    catch (err) {
        return false;
    }
}
function getExtensionDownloadStream(extension) {
    const url = extension.metadata.multiPlatformServiceUrl || productjson.extensionsGallery?.serviceUrl;
    return (url ? ext.fromMarketplace(url, extension, true) : ext.fromGithub(extension))
        .pipe(rename(p => { p.basename = `${extension.name}-${extension.version}.vsix`; }));
}
function getBootstrapExtensionStream(extension) {
    // if the extension exists on disk, use those files instead of downloading anew
    if (isUpToDate(extension)) {
        log('[extensions]', `${extension.name}@${extension.version} up to date`, ansiColors.green('✔︎'));
        return vfs.src(['**'], { cwd: getExtensionPath(extension), dot: true })
            .pipe(rename(p => p.dirname = `${extension.name}/${p.dirname}`));
    }
    return getExtensionDownloadStream(extension);
}
function syncMarketplaceExtension(extension) {
    const galleryServiceUrl = productjson.extensionsGallery?.serviceUrl;
    const source = ansiColors.blue(galleryServiceUrl ? '[marketplace]' : '[github]');
    if (isUpToDate(extension)) {
        log(source, `${extension.name}@${extension.version}`, ansiColors.green('✔︎'));
        return es.readArray([]);
    }
    rimraf.sync(getExtensionPath(extension));
    return getExtensionDownloadStream(extension)
        .pipe(vfs.dest('.build/bootstrapExtensions'))
        .on('end', () => log(source, extension.name, ansiColors.green('✔︎')));
}
function syncExtension(extension, controlState) {
    if (extension.platforms) {
        const platforms = new Set(extension.platforms);
        if (!platforms.has(process.platform)) {
            log(ansiColors.gray('[skip]'), `${extension.name}@${extension.version}: Platform '${process.platform}' not supported: [${extension.platforms}]`, ansiColors.green('✔︎'));
            return es.readArray([]);
        }
    }
    switch (controlState) {
        case 'disabled':
            log(ansiColors.blue('[disabled]'), ansiColors.gray(extension.name));
            return es.readArray([]);
        case 'marketplace':
            // --- Start Positron ---
            return syncMarketplaceExtension(extension);
        // --- End Positron ---
        default:
            if (!fs.existsSync(controlState)) {
                // --- Start Positron ---
                log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
                // --- End Positron ---
                return es.readArray([]);
            }
            else if (!fs.existsSync(path.join(controlState, 'package.json'))) {
                // --- Start Positron ---
                log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
                // --- End Positron ---
                return es.readArray([]);
            }
            log(ansiColors.blue('[local]'), `${extension.name}: ${ansiColors.cyan(controlState)}`, ansiColors.green('✔︎'));
            return es.readArray([]);
    }
}
function readControlFile() {
    try {
        return JSON.parse(fs.readFileSync(controlFilePath, 'utf8'));
    }
    catch (err) {
        return {};
    }
}
function writeControlFile(control, filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(control, null, 2));
}
function getBootstrapExtensions() {
    const control = readControlFile();
    const streams = [];
    for (const extension of [...bootstrapExtensions]) {
        const controlState = control[extension.name] || 'marketplace';
        control[extension.name] = controlState;
        streams.push(syncExtension(extension, controlState));
    }
    writeControlFile(control, controlFilePath);
    return new Promise((resolve, reject) => {
        es.merge(streams)
            .on('error', reject)
            .on('end', resolve);
    });
}
if (require.main === module) {
    getBootstrapExtensions().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=bootstrapExtensions.js.map