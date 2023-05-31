"""
Custom entry point for launching Positron's extensions to the Jedi Language
Server and IPyKernel in the same environment.
"""

import asyncio
import argparse
import logging
import os
import sys

from ipykernel import kernelapp

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))
sys.path.insert(1, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "python"))

from positron.positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)


def initialize_config() -> None:
    """
    Initialize the configuration for the Positron Python Language Server
    and REPL Kernel.
    """

    # Given we're using TCP, support a subset of the Jedi LSP configuration
    parser = argparse.ArgumentParser(
        prog="positron-language-server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Positron Jedi language server: an LSP wrapper for jedi.",
    )

    parser.add_argument(
        "--debugport",
        help="port for debugpy debugger",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--logfile",
        help="redirect logs to file specified",
        type=str,
    )
    parser.add_argument(
        "--loglevel",
        help="logging level",
        type=str,
        default="error",
        choices=["critical", "error", "warning", "info", "debug", "notset"],
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

    args.loglevel = args.loglevel.upper()
    if args.logfile:
        logging.basicConfig(
            filename=args.logfile,
            filemode="w",
            level=args.loglevel,
        )
    else:
        logging.basicConfig(stream=sys.stderr, level=args.loglevel)

    # Start the debugpy debugger if a port was specified
    if args.debugport is not None:
        try:
            import debugpy

            debugpy.listen(args.debugport)
        except Exception as error:
            logging.warning(f"Unable to start debugpy: {error}", exc_info=True)


if __name__ == "__main__":
    exit_status = 0

    # Init the configuration args
    initialize_config()

    # Start Positron's IPyKernel as the interpreter for our console.
    app = kernelapp.IPKernelApp.instance(kernel_class=PositronIPyKernel)
    app.initialize()
    app.kernel.start()

    logger.info(f"Process ID {os.getpid()}")

    # IPyKernel uses Tornado which (as of version 5.0) shares the same event
    # loop as asyncio.
    loop = asyncio.get_event_loop()

    # Enable asyncio debug mode.
    if logging.getLogger().level == logging.DEBUG:
        loop.set_debug(True)

    try:
        loop.run_forever()
    except (KeyboardInterrupt, SystemExit):
        logger.exception("Unexpected exception in event loop")
        exit_status = 1
    finally:
        loop.close()

    logger.info(f"Exiting process with status {exit_status}")
    sys.exit(exit_status)
