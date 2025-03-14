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
exports.getExtensionStream = getExtensionStream;
exports.getBuiltInExtensions = getBuiltInExtensions;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const rimraf_1 = __importDefault(require("rimraf"));
const event_stream_1 = __importDefault(require("event-stream"));
const gulp_rename_1 = __importDefault(require("gulp-rename"));
const vinyl_fs_1 = __importDefault(require("vinyl-fs"));
const ext = __importStar(require("./extensions"));
const fancy_log_1 = __importDefault(require("fancy-log"));
const ansi_colors_1 = __importDefault(require("ansi-colors"));
const root = path_1.default.dirname(path_1.default.dirname(__dirname));
const productjson = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, '../../product.json'), 'utf8'));
const builtInExtensions = productjson.builtInExtensions || [];
const webBuiltInExtensions = productjson.webBuiltInExtensions || [];
const controlFilePath = path_1.default.join(os_1.default.homedir(), '.vscode-oss-dev', 'extensions', 'control.json');
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BUILTIN_EXTENSIONS_SILENCE_PLEASE'];
function log(...messages) {
    if (ENABLE_LOGGING) {
        (0, fancy_log_1.default)(...messages);
    }
}
function getExtensionPath(extension) {
    return path_1.default.join(root, '.build', 'builtInExtensions', extension.name);
}
function isUpToDate(extension) {
    const packagePath = path_1.default.join(getExtensionPath(extension), 'package.json');
    if (!fs_1.default.existsSync(packagePath)) {
        return false;
    }
    const packageContents = fs_1.default.readFileSync(packagePath, { encoding: 'utf8' });
    try {
        const diskVersion = JSON.parse(packageContents).version;
        return (diskVersion === extension.version);
    }
    catch (err) {
        return false;
    }
}
function getExtensionDownloadStream(extension) {
    // --- Start PWB: Bundle PWB extension ---
    // the PWB extension is a special case because it's not availble from the marketplace or github
    if (extension.name === 'rstudio.rstudio-workbench') {
        return ext.fromPositUrl(extension)
            .pipe((0, gulp_rename_1.default)(p => p.dirname = `${extension.name}/${p.dirname}`));
    }
    // --- End PWB: Bundle PWB extension ---
    // --- Start Positron ---
    const url = extension.metadata.multiPlatformServiceUrl || productjson.extensionsGallery?.serviceUrl;
    return (url ? ext.fromMarketplace(url, extension) : ext.fromGithub(extension))
        // --- End Positron ---
        .pipe((0, gulp_rename_1.default)(p => p.dirname = `${extension.name}/${p.dirname}`));
}
function getExtensionStream(extension) {
    // if the extension exists on disk, use those files instead of downloading anew
    if (isUpToDate(extension)) {
        log('[extensions]', `${extension.name}@${extension.version} up to date`, ansi_colors_1.default.green('✔︎'));
        return vinyl_fs_1.default.src(['**'], { cwd: getExtensionPath(extension), dot: true })
            .pipe((0, gulp_rename_1.default)(p => p.dirname = `${extension.name}/${p.dirname}`));
    }
    return getExtensionDownloadStream(extension);
}
function syncMarketplaceExtension(extension) {
    const galleryServiceUrl = productjson.extensionsGallery?.serviceUrl;
    const source = ansi_colors_1.default.blue(galleryServiceUrl ? '[marketplace]' : '[github]');
    if (isUpToDate(extension)) {
        log(source, `${extension.name}@${extension.version}`, ansi_colors_1.default.green('✔︎'));
        return event_stream_1.default.readArray([]);
    }
    rimraf_1.default.sync(getExtensionPath(extension));
    return getExtensionDownloadStream(extension)
        .pipe(vinyl_fs_1.default.dest('.build/builtInExtensions'))
        .on('end', () => log(source, extension.name, ansi_colors_1.default.green('✔︎')));
}
function syncExtension(extension, controlState) {
    if (extension.platforms) {
        const platforms = new Set(extension.platforms);
        if (!platforms.has(process.platform)) {
            log(ansi_colors_1.default.gray('[skip]'), `${extension.name}@${extension.version}: Platform '${process.platform}' not supported: [${extension.platforms}]`, ansi_colors_1.default.green('✔︎'));
            return event_stream_1.default.readArray([]);
        }
    }
    switch (controlState) {
        case 'disabled':
            log(ansi_colors_1.default.blue('[disabled]'), ansi_colors_1.default.gray(extension.name));
            return event_stream_1.default.readArray([]);
        case 'marketplace':
            return syncMarketplaceExtension(extension);
        default:
            if (!fs_1.default.existsSync(controlState)) {
                log(ansi_colors_1.default.red(`Error: Built-in extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
                return event_stream_1.default.readArray([]);
            }
            else if (!fs_1.default.existsSync(path_1.default.join(controlState, 'package.json'))) {
                log(ansi_colors_1.default.red(`Error: Built-in extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
                return event_stream_1.default.readArray([]);
            }
            log(ansi_colors_1.default.blue('[local]'), `${extension.name}: ${ansi_colors_1.default.cyan(controlState)}`, ansi_colors_1.default.green('✔︎'));
            return event_stream_1.default.readArray([]);
    }
}
function readControlFile() {
    try {
        return JSON.parse(fs_1.default.readFileSync(controlFilePath, 'utf8'));
    }
    catch (err) {
        return {};
    }
}
function writeControlFile(control) {
    fs_1.default.mkdirSync(path_1.default.dirname(controlFilePath), { recursive: true });
    fs_1.default.writeFileSync(controlFilePath, JSON.stringify(control, null, 2));
}
function getBuiltInExtensions() {
    log('Synchronizing built-in extensions...');
    log(`You can manage built-in extensions with the ${ansi_colors_1.default.cyan('--builtin')} flag`);
    const control = readControlFile();
    const streams = [];
    for (const extension of [...builtInExtensions, ...webBuiltInExtensions]) {
        const controlState = control[extension.name] || 'marketplace';
        control[extension.name] = controlState;
        // --- Start Positron ---
        // Discard extensions intended for the web. The 'type' field isn't a
        // formal part of the extension definition but a custom field we use to
        // filter out web-only extensions (i.e. Posit Workbench)
        // @ts-ignore
        if (extension.type === 'reh-web') {
            continue;
        }
        // --- End Positron ---
        streams.push(syncExtension(extension, controlState));
    }
    writeControlFile(control);
    return new Promise((resolve, reject) => {
        event_stream_1.default.merge(streams)
            .on('error', reject)
            .on('end', resolve);
    });
}
if (require.main === module) {
    getBuiltInExtensions().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=builtInExtensions.js.map