cat("[.Rprofile] top-level code executed\n")

setHook("positron.session_init", function(start_type) {
	cat(paste0("[hook:init] start_type=", start_type, "\n"))

	# Verify console width detection works (not the R default 80)
	width <- getOption("width")
	cat(paste0("[hook:init] options_width=", width, "\n"))

	# Verify cli::console_width() returns actual width (common user pattern)
	if (requireNamespace("cli", quietly = TRUE)) {
		cli_width <- cli::console_width()
		cat(paste0("[hook:init] cli_width=", cli_width, "\n"))
	}

	# Verify two-way rstudioapi communication works inside hook
	project <- basename(rstudioapi::getActiveProject())
	cat(paste0("[hook:init] project=", project, "\n"))

	# Verify rstudioapi can trigger UI actions (navigateToFile)
	rstudioapi::navigateToFile("DESCRIPTION")
	cat("[hook:init] navigateToFile DESCRIPTION completed\n")
})

setHook("positron.session_reconnect", function() {
	cat("[hook:reconnect] fired\n")

	# Verify width detection works on reconnect too
	width <- getOption("width")
	cat(paste0("[hook:reconnect] options_width=", width, "\n"))

	if (requireNamespace("cli", quietly = TRUE)) {
		cli_width <- cli::console_width()
		cat(paste0("[hook:reconnect] cli_width=", cli_width, "\n"))
	}

	# Verify rstudioapi works on reconnect
	project <- basename(rstudioapi::getActiveProject())
	cat(paste0("[hook:reconnect] project=", project, "\n"))
})
