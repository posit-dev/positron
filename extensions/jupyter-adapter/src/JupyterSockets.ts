/*
 * JupyterSockets.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

export enum JupyterSockets {
    shell = "shell",
    iopub = "iopub",
    heartbeat = "heartbeat",
    stdin = "stdin",
    control = "control"
}
