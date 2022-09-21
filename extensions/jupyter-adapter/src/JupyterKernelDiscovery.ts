/*
 * JupyterKernelDiscovery.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import os = require("os");
import fs = require("fs");
import path = require("path");

/**
 * Gets metadata about the Jupyter kernel installed in the given directory.
 * 
 * @param dir The directory to search for kernels
 * @returns A promise, with either the kernel metadata or null if no kernel
 *   exists in the directory.
 */
function getKernelMetadata(dir: string): Promise<JupyterKernelSpec | null> {
    return new Promise((resolve, reject) => {

        // Form the path to the kernel defintion
        let kerneljs = path.join(dir, "kernel.json");

        // If the file exists and can be read...
        fs.access(kerneljs, fs.constants.R_OK, (err) => {
            if (err) {
                // Not an error, just no kernel definition in this directory.
                resolve(null);
            } else {
                // Read and parse the contents of the definition. 
                fs.readFile(kerneljs, (err, data) => {
                    if (err) {
                        console.log("Couldn't read kernel definition at " + kerneljs + ": " + err.message);
                        resolve(null);
                    }
                    try {
                        let kernel: JupyterKernelSpec = JSON.parse(data.toString());
                        resolve(kernel);
                    } catch (err) {
                        console.log("Couldn't parse kernel definition at " + kerneljs + ": " + err);
                        resolve(null);
                    }
                });
            }
        });
    });
}

/**
 * Discovers all Jupyter kernels in a folder that could contain several.
 * 
 * @param dir 
 */
function discoverKernels(dir: string): Promise<Array<JupyterKernelSpec>> {
    return new Promise((resolve, reject) => {
        fs.readdir(dir, (err, files) => {

            if (err) {
                console.warn("Couldn't read kernel metadata directory '" + dir + "': " + err.message);
                resolve([]);
            }

            // If no files are discovered, resolve with an empty array
            if (!files) {
                resolve([]);
            }

            let promises: Array<Promise<JupyterKernelSpec | null>> = [];
            for (let i = 0; i < files.length; i++) {
                promises.push(getKernelMetadata(path.join(dir, files[i])));
            }
            Promise.all(promises).then(values => {
                // Remove null kernels and resolve the promise with the remainder
                values.filter(kernel => kernel !== null);
                resolve(values as Array<JupyterKernelSpec>);
            });
        });
    });
}

/**
 * Discovers locally installed Jupyter kernels.
 */
export function discoverAllKernels(): Promise<Array<JupyterKernelSpec>> {

    // Source: https://jupyter-client.readthedocs.io/en/stable/kernels.html

    return new Promise((resolve, reject) => {
        // Array of locations to search for installed kernels
        let dirs: Array<string> = [];

        if (process.platform === "win32") {
            // TODO: these probably need to get expanded
            dirs.push("%APPDATA%\\jupyter\\kernels");
            dirs.push("%PROGRAMDATA%\\jupyter\\kernels");
        } else {
            // Common system locations on all Unix-like platforms
            dirs.push("/usr/share/jupyter/kernels");
            dirs.push("/usr/local/share/jupyter/kernels");

            // Per-user location
            if (process.platform === "darwin") {
                // macOS
                dirs.push(path.join(os.homedir(), "Library/Jupyter/kernels"));
            } else {
                // Linux and all other Unix platforms
                dirs.push(path.join(os.homedir(), ".local/share/jupyter/kernels"));
            }
        }

        let promises: Array<Promise<Array<JupyterKernelSpec>>> = [];
        for (let i = 0; i < dirs.length; i++) {
            promises.push(discoverKernels(path.resolve(dirs[i])));
        }
        Promise.all(promises).then(value => {
            // Each promise produces an array of kernels; flatten them to a single array
            resolve(value.reduce((acc, val) => acc.concat(val), []));
        });
    });
}