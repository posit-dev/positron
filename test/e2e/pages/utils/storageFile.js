"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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
exports.StorageFile = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const STORAGE_FILENAME = 'state.vscdb';
/**
 * Helper class to manage the Positron storage database (state.vscdb).
 * This is useful for pre-populating storage values in e2e tests to avoid
 * UI prompts or set specific state before the app starts.
 */
class StorageFile {
    storagePath;
    /**
     * Creates a new StorageFile instance.
     * @param userDir The user data directory (e.g., userDataDir/User)
     */
    constructor(userDir) {
        this.storagePath = path_1.default.join(userDir, 'globalStorage', STORAGE_FILENAME);
    }
    /**
     * Checks if the storage database file exists.
     */
    async exists() {
        try {
            await fs_1.promises.access(this.storagePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Gets all storage values from the database.
     * @returns A map of key-value pairs, or empty map if database doesn't exist
     */
    async getAll() {
        const items = new Map();
        if (!(await this.exists())) {
            return items;
        }
        const sqlite3 = await Promise.resolve().then(() => __importStar(require('@vscode/sqlite3')));
        return new Promise((resolve, reject) => {
            const db = new sqlite3.default.Database(this.storagePath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                db.all('SELECT key, value FROM ItemTable', (err, rows) => {
                    if (err) {
                        db.close();
                        // Only treat "no such table" as expected (empty DB), reject other errors
                        if (err.message?.includes('no such table')) {
                            resolve(items);
                        }
                        else {
                            reject(err);
                        }
                        return;
                    }
                    if (rows) {
                        for (const row of rows) {
                            items.set(row.key, row.value);
                        }
                    }
                    db.close((err) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(items);
                        }
                    });
                });
            });
        });
    }
    /**
     * Sets a storage value in the database.
     * Creates the database and table if they don't exist.
     * @param key The storage key
     * @param value The value to store (will be converted to string)
     * @param log Whether to dump raw DB contents after setting (default: false)
     */
    async set(key, value, log = false) {
        await this.setMultiple({ [key]: value });
        if (log) {
            await this.logContents();
        }
    }
    /**
     * Sets multiple storage values at once using a single database connection.
     * @param values An object containing key-value pairs to store
     */
    async setMultiple(values) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.storagePath), { recursive: true });
        const sqlite3 = await Promise.resolve().then(() => __importStar(require('@vscode/sqlite3')));
        const entries = Object.entries(values).map(([key, value]) => [
            key,
            typeof value === 'string' ? value : String(value)
        ]);
        await new Promise((resolve, reject) => {
            const db = new sqlite3.default.Database(this.storagePath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                db.serialize(() => {
                    db.run('PRAGMA user_version = 1');
                    db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
                    const stmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
                    let insertError = null;
                    for (const [key, value] of entries) {
                        stmt.run(key, value, (err) => {
                            if (err && !insertError) {
                                insertError = err; // Capture first error
                            }
                        });
                    }
                    stmt.finalize((err) => {
                        const finalError = err || insertError;
                        if (finalError) {
                            db.close();
                            reject(finalError);
                            return;
                        }
                        db.close((err) => {
                            if (err) {
                                reject(err);
                            }
                            else {
                                resolve();
                            }
                        });
                    });
                });
            });
        });
    }
    /**
     * Logs the raw database contents for debugging using the sqlite3 library.
     */
    async logContents() {
        try {
            const items = await this.getAll();
            const lines = Array.from(items.entries()).map(([k, v]) => `${k}|${v}`).join('\n');
            console.log(`[StorageFile] ${this.storagePath}:\n${lines}`);
        }
        catch (err) {
            console.log(`[StorageFile] Error reading file: ${err}`);
        }
    }
}
exports.StorageFile = StorageFile;
//# sourceMappingURL=storageFile.js.map