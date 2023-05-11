"""
Custom entry point for launching Positron's extensions to the Jedi Language
Server and IPyKernel in the same environment.
"""

import asyncio
import argparse
import logging
import os
import sys
import traceback

from ipykernel import kernelapp

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))
sys.path.insert(1, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "python"))

from positron.positron_ipkernel import PositronIPyKernel


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

    if args.logfile:
        logging.basicConfig(
            filename=args.logfile,
            filemode="w",
            level=logging.INFO,
        )
    else:
        logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

    # Start the debugpy debugger if a port was specified
    if args.debugport is not None:
        try:
            import debugpy

            debugpy.listen(args.debugport)
        except Exception as error:
            logging.warning(f"Unable to start debugpy: {error}", exc_info=True)


async def start_ipykernel() -> None:
    """Starts Positron's IPyKernel as the interpreter for our console."""
    app = kernelapp.IPKernelApp.instance(kernel_class=PositronIPyKernel)
    app.initialize()
    app.kernel.start()


if __name__ == "__main__":
    exitStatus = 0

    try:
        # Init the configuration args
        initialize_config()

        # Start Positron's IPyKernel as the interpreter for our console.
        loop = asyncio.get_event_loop()
        try:
            asyncio.ensure_future(start_ipykernel())
            loop.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            loop.close()

    except SystemExit as error:
        # TODO: Remove this workaround once we can improve Jedi
        # disconnection logic
        tb = "".join(traceback.format_tb(error.__traceback__))
        if tb.find("connection_lost") > 0:
            logging.warning("Positron Language Server client disconnected, exiting.")
            exitStatus = 0
        else:
            logging.error("Error in Positron Language Server: %s", error)
            exitStatus = 1

    sys.exit(exitStatus)
