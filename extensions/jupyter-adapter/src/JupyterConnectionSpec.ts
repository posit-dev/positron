/*
 * JupyterConnectionSpec.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

/**
 * Represents the connection between a front end and a Jupyter kernel.
 * 
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html
 */
interface JupyterConnectionSpec {
    /** ROUTER/DEALER: The port for control messages (shutdown/restart) */
    control_port: number;  // eslint-disable-line

    /** ROUTER/DEALER: The port for shell messages (code execution, object info, etc.) */
    shell_port: number;  // eslint-disable-line

    /** The network transport (e.g. "tcp") */
    transport: string;

    /** The signature scheme, as in hmac-METHOD */
    signature_scheme: string;  // eslint-disable-line

    /** ROUTER/DEALER: The port for stdin messages; allows the kernel to request input from frontend */
    stdin_port: number;  // eslint-disable-line

    /** REQ/REP: The port for heartbeat messages */
    hb_port: number;  // eslint-disable-line

    /** The IP address for the TCP transport */
    ip: string;

    /** PUB/SUB: The port for publishing input and output side effects (stdout, stderr, debugging) */
    iopub_port: number;  // eslint-disable-line

    /** The key for signing messages */
    key: string;
}