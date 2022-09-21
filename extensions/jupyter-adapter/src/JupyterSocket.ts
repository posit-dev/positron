/*
 * JupyterSocket.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { Disposable } from 'vscode';
import zmq = require('zeromq/v5-compat');
import net = require('net');

export class JupyterSocket implements Disposable {
    private readonly _socket: zmq.Socket;
    private readonly _title: string;
    private _addr: string;
    private _port: number;

    /**
     * Create a new JupyterSocket
     * 
     * @param title The title of the socket
     * @param socket The underlying ZeroMQ socket
     */
    constructor(title: string, socket: zmq.Socket) {
        this._socket = socket;
        this._title = title;

        this._addr = '';
        this._port = 0;
    }

    /**
     * Sets the ZeroMQ identity of the socket; to be called before the socket is
     * bound/connected if a specific identity is required
     *  
     * @param identity The ZeroMQ identity of the socket, as a buffer of bytes
     *   (typically a UUID)
     */
    public setZmqIdentity(identity: Buffer): void {
        this._socket.setsockopt('identity', identity);
    }

    /**
     * Find an address/port to bind to.
     * 
     * @param excluding A list of ports to exclude from the search
     * @returns The port to bind to
     */
    public async bind(excluding: Array<number>): Promise<number> {
        const maxTries = 25;
        return new Promise((resolve, reject) => {
            this.findAvailablePort(excluding, maxTries).then((port: number) => {
                this._port = port;
                this._addr = 'tcp://127.0.0.1:' + port.toString();
                this._socket.connect(this._addr);
                console.log('Using available port ' + port.toString() + ' for ' + this._title + ' socket');
                resolve(port);
            })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    /**
     * Gets the underlying ZeroMQ socket
     * 
     * @returns A ZeroMQ socket
     */
    public socket(): zmq.Socket {
        return this._socket;
    }

    /**
     * Gets the address used by the socket
     * 
     * @returns The address, or an empty string if the socket is unbound
     */
    public address(): string {
        return this._addr;
    }

    /**
     * Get the port used by the socket
     * 
     * @returns The port, or 0 if the socket is unbound
     */
    public port(): number {
        return this._port;
    }

    /**
     * Cleans up the socket.
     */
    public dispose(): void {
        this._socket.disconnect(this._addr);
    }

    /**
     * Finds an available TCP port for a server
     * 
     * @param excluding A list of ports to exclude from the search
     * @param maxTries The maximum number of attempts
     * @returns An available TCP port
     */
    private async findAvailablePort(excluding: Array<number>, maxTries: number): Promise<number> {

        const portmin = 41952;
        const portmax = 65536;
        let nextPort = this.findAvailablePort;
        let title = this._title;

        return new Promise((resolve, reject) => {
            // Pick a random port not on the exclusion list
            let candidate = 0;
            do {
                candidate = Math.floor(Math.random() * (portmax - portmin) + portmin);
            } while (excluding.includes(candidate));

            let test = net.createServer();

            // If we can't bind to the port, pick another random port
            test.once('error', function (err) {
                // ... unless we've already tried too many times; likely there's
                // a networking issue
                if (maxTries < 1) {
                    console.log('Could not find an available port for ' + title + ' socket');
                    reject(err);
                }

                //  Try again
                resolve(nextPort(excluding, maxTries - 1));
            });

            // If we CAN bind to the port, shutdown the server and return the
            // port when it's available
            test.once('listening', function () {
                test.once('close', function () {
                    resolve(candidate);
                });
                test.close();
            });

            // Begin attempting to listen on the candidate port
            test.listen(candidate);
        });
    }
}