"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
exports.getFreeMemory = getFreeMemory;
exports.getLoadAverageAndCpuUsage = getLoadAverageAndCpuUsage;
exports.getCondensedProcessList = getCondensedProcessList;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
/**
 * Get the amount of free memory in a human-readable format
 */
function getFreeMemory() {
    const freeMemBytes = os.freemem();
    const freeMB = (freeMemBytes / 1024 / 1024).toFixed(2);
    const freeGB = (freeMemBytes / 1024 / 1024 / 1024).toFixed(2);
    return `${freeMB} MB (${freeGB} GB)`;
}
/**
 * Get load average and CPU usage information (Unix-like systems)
 *
 * @returns The load average and CPU usage string, or a message indicating it's not available
 */
function getLoadAverageAndCpuUsage() {
    if (process.platform === 'win32') {
        return 'Load average and CPU usage information is not available on Windows.';
    }
    try {
        const loadAvg = os.loadavg(); // [1min, 5min, 15min]
        const cpuInfo = os.cpus();
        const loadAvgStr = `Load Average (1m, 5m, 15m): ${loadAvg.map(avg => avg.toFixed(2)).join(', ')}`;
        // Calculate CPU usage
        const cpuUsage = cpuInfo.map((cpu, index) => {
            const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            const idle = cpu.times.idle;
            const usage = ((total - idle) / total) * 100;
            return `CPU${index}: ${usage.toFixed(2)}%`;
        }).join(', ');
        return `${loadAvgStr}\nCPU Usage: ${cpuUsage}`;
    }
    catch (error) {
        return `Error getting load average and CPU usage: ${error}`;
    }
}
/**
 * Get a condensed process listing with duplicate processes shown using multiplier notation
 * Example: "node x3, Electron x2, chrome x5"
 */
function getCondensedProcessList() {
    try {
        let processOutput;
        if (process.platform === 'win32') {
            // Windows: use tasklist
            processOutput = (0, child_process_1.execSync)('tasklist /FO CSV /NH', { encoding: 'utf8' });
            const processes = processOutput
                .split('\n')
                .filter(line => line.trim())
                .map(line => {
                // Parse CSV format: "processname.exe","PID","Session","Mem Usage"
                const match = line.match(/^"([^"]+)"/);
                return match ? match[1].replace('.exe', '') : '';
            })
                .filter(name => name);
            return condenseProcessNames(processes);
        }
        else {
            // macOS/Linux: use ps
            processOutput = (0, child_process_1.execSync)('ps -eo comm=', { encoding: 'utf8' });
            const processes = processOutput
                .split('\n')
                .map(line => line.trim())
                .filter(name => name)
                .map(name => {
                // Remove path, keep just the executable name
                const parts = name.split('/');
                return parts[parts.length - 1];
            });
            return condenseProcessNames(processes);
        }
    }
    catch (error) {
        return `Error getting process list: ${error}`;
    }
}
/**
 * Takes an array of process names and returns a condensed string with multiplier notation
 */
function condenseProcessNames(processes) {
    const processCount = new Map();
    // Count occurrences of each process
    for (const process of processes) {
        processCount.set(process, (processCount.get(process) || 0) + 1);
    }
    // Sort by count (descending) then by name
    const sortedProcesses = Array.from(processCount.entries())
        .sort((a, b) => {
        if (b[1] !== a[1]) {
            return b[1] - a[1]; // Sort by count descending
        }
        return a[0].localeCompare(b[0]); // Then by name
    });
    // Format as "name x count" or just "name" if count is 1
    const condensed = sortedProcesses
        .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
        .join(', ');
    return condensed;
}
//# sourceMappingURL=systemDiagnostics.js.map