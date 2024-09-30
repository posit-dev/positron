"""
Custom entry point for launching Positron's extensions to the Jedi Language
Server and IPyKernel in the same environment.
"""

import argparse
import asyncio
import logging
import os
import sys

from positron_ipykernel.positron_ipkernel import PositronIPKernelApp, PositronIPyKernel
from positron_ipykernel.positron_jedilsp import POSITRON
from positron_ipykernel.session_mode import SessionMode

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
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
        choices=["critical", "error", "warn", "info", "debug"],
    )
    parser.add_argument(
        "-f",
        "--connection-file",
        help="location of the IPyKernel connection file",
        type=str,
    )
    parser.add_argument(
        "-q",
        "--quiet",
        help="Suppress console startup banner information",
        action="store_true",
    )
    parser.add_argument(
        "--session-mode",
        help="session mode in which the kernel is to be started",
        type=SessionMode,
        default=SessionMode.DEFAULT,
        choices=sorted(SessionMode),
    )
    args = parser.parse_args()
    args.loglevel = args.loglevel.upper()

    return args


if __name__ == "__main__":
    exit_status = 0

    # Parse command-line arguments
    args = parse_args()

    # Start the debugpy debugger if a port was specified
    if args.debugport is not None:
        try:
            import debugpy

            debugpy.listen(args.debugport)
        except Exception as error:
            logger.warning(f"Unable to start debugpy: {error}", exc_info=True)

    # Configure logging by passing the IPKernelApp traitlets application by passing a logging config
    # dict. See: https://docs.python.org/3/library/logging.config.html#logging-config-dictschema for
    # more info about this schema.
    handlers = ["console"] if args.logfile is None else ["file"]
    logging_config = {
        "loggers": {
            "": {
                "level": args.loglevel,
                "handlers": handlers,
            },
            "PositronIPKernelApp": {
                "level": args.loglevel,
                "handlers": handlers,
            },
        }
    }
    if args.logfile is not None:
        logging_config["handlers"] = {
            "file": {
                "class": "logging.FileHandler",
                "formatter": "console",
                "level": args.loglevel,
                "filename": args.logfile,
            }
        }

    # IPKernelApp expects an empty string if no connection_file is provided.
    if args.connection_file is None:
        args.connection_file = ""

    # Start Positron's IPyKernel as the interpreter for our console.
    app: PositronIPKernelApp = PositronIPKernelApp.instance(
        connection_file=args.connection_file,
        log_level=args.loglevel,
        logging_config=logging_config,
        session_mode=args.session_mode,
    )
    # Initialize with empty argv, otherwise BaseIPythonApplication.initialize reuses our
    # command-line arguments in unexpected ways (e.g. logfile instructs it to log executed code).
    app.initialize(argv=[])
    assert app.kernel is not None, "Kernel was not initialized"
    # Disable the banner if running in quiet mode.
    if args.quiet:
        app.kernel.shell.banner1 = ""

    app.kernel.start()

    logger.info(f"Process ID {os.getpid()}")

    # IPyKernel uses Tornado which (as of version 5.0) shares the same event
    # loop as asyncio.
    loop = asyncio.get_event_loop_policy().get_event_loop()

    # Enable asyncio debug mode.
    if args.loglevel == "DEBUG":
        loop.set_debug(True)
        POSITRON.set_debug(True)

    try:
        loop.run_forever()
    except (KeyboardInterrupt, SystemExit):
        logger.exception("Unexpected exception in event loop")
        exit_status = 1
    finally:
        loop.close()

    # When the app is gone, it should be safe to clear singleton instances.
    # This allows re-starting the ipykernel in the same process, using different
    # connection strings, etc.
    PositronIPyKernel.clear_instance()
    PositronIPKernelApp.clear_instance()

    logger.info(f"Exiting process with status {exit_status}")
    sys.exit(exit_status)
