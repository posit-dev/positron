"""
Custom entry point for launching Positron's extensions to the Jedi Language
Server and IPyKernel in the same environment.
"""

import debugpy
import argparse
import logging
import os
import sys
import traceback

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))

from positron_jedilsp import POSITRON

def initialize() -> (str, int):
    """
    Initialize the configuration for the Positron Python Language Server
    and REPL Kernel.

    Returns:
        (str, int): TCP host and port of the LSP server
    """

    # Given we're using TCP, support a subset of the Jedi LSP configuration
    parser = argparse.ArgumentParser(
        prog="jedi-language-server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Positron Jedi language server: an LSP wrapper for jedi.")

    parser.add_argument(
        "--host",
        help="host for web server (default 127.0.0.1)",
        type=str,
        default="127.0.0.1",
    )
    parser.add_argument(
        "--port",
        help="port for web server (default 2087)",
        type=int,
        default=2087,
    )
    parser.add_argument(
        "--logfile",
        help="redirect logs to file specified",
        type=str,
    )
    parser.add_argument(
        "-f",
        help="location of the IPyKernel configuration file",
        type=str,
    )
    parser.add_argument(
        "-v",
        "--verbose",
        help="increase verbosity of log output",
        action="count",
        default=0,
    )
    args = parser.parse_args()

    log_level = {0: logging.WARN, 1: logging.INFO, 2: logging.DEBUG}.get(
        args.verbose,
        logging.INFO,
    )

    if args.logfile:
        logging.basicConfig(
            filename=args.logfile,
            filemode="w",
            level=log_level,
        )
    else:
        logging.basicConfig(stream=sys.stderr, level=log_level)

    return args.host, args.port


def start(lsp_host, lsp_port):
    """
    Starts Positron Python (based on the Jedi Language Server) to
    suport both LSP and REPL functionality.
    """
    exitStatus = POSITRON.start(lsp_host, lsp_port)
    return exitStatus


if __name__ == "__main__":

    exitStatus = 0

    try:
        lsp_host, lsp_port = initialize()
        exitStatus = start(lsp_host, lsp_port)
    except SystemExit as error:
        # TODO: Remove this workaround once we can improve Jedi
        # disconnection logic
        tb = ''.join(traceback.format_tb(error.__traceback__))
        if tb.find('connection_lost') > 0:
            logging.warning('Positron LSP client disconnected, exiting.')
            exitStatus = 0
        else:
            logging.error('Error in Positron Jedi LSP: %s', error)

    sys.exit(exitStatus)
