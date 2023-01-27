"""Custom entry point for launching Jedi and ipykernel in the same environment."""

import argparse
import logging
import os
import sys

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))

from ipykernel import kernelapp
from jedi_language_server.server import SERVER
from multiprocessing import Pool

def start_ipykernel():
    app = kernelapp.IPKernelApp.instance()
    app.initialize()
    app.start()

def start_jedi():

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
        logging.DEBUG,
    )

    if args.logfile:
        logging.basicConfig(
            filename=args.logfile,
            filemode="w",
            level=log_level,
        )
    else:
        logging.basicConfig(stream=sys.stderr, level=log_level)

    SERVER.start_tcp(host=args.host, port=args.port)

def ipk_error_handler(error):
    logging.error('Error in Positron IPyKernel Jedi: %s', error)

if __name__ == "__main__":

    # Start ipykernel as an async process
    pool = Pool(processes=1)
    result = pool.apply_async(start_ipykernel, error_callback=ipk_error_handler)

    # Start Jedi language server using TCP
    sys.exit(start_jedi())
