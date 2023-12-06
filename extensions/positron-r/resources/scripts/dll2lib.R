# ---------------------------------------------------------------------------------------------
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
# ---------------------------------------------------------------------------------------------

# 2023-12-06
# At the time of writing, this script is for "manual" execution on Windows.
# For the moment, it is a one-time setup task for a specific R installation.
#
# You must be running R as an administrator to execute this script.
# If, for example, you do this via RStudio, make sure to launch RStudio as an administrator.

# Typically something like:
# "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.37.32822\\bin\\Hostx86\\x86"
# We try to dynamically look up the year (2022) and exact version (14.37.32822)
# in case they change on us
get_visual_studio_tools_directory <- function() {
  path <- file.path("C:", "Program Files", "Microsoft Visual Studio")

  if (!dir.exists(path)) {
    stop("Microsoft Visual Studio has not been installed.")
  }

  # Dynamically look up the next folder, which should be a year like `2022`
  files <- dir(path)
  n_files <- length(files)

  if (n_files == 0L) {
    stop("Expected at least 1 version of Microsoft Visual Studio.")
  } else if (n_files == 1L) {
    year <- files
  } else {
    warning("Expected exactly 1 version of Microsoft Visual Studio. Using the last (hopefully newest) version.")
    year <- files[[n_files]]
  }

  path <- file.path(path, year, "Community", "VC", "Tools", "MSVC")

  if (!dir.exists(path)) {
    stop("Microsoft Visual Studio tools have not been installed.")
  }

  # Dynamically look up the next folder, which should be a very specific version
  # of the tools like `14.38.33130`
  files <- dir(path)
  n_files <- length(files)

  if (n_files == 0L) {
    stop("Expected at least 1 version of the Microsoft Visual Studio tools.")
  } else if (n_files == 1L) {
    version <- files
  } else {
    warning("Expected exactly 1 version of the Microsoft Visual Studio tools. Using the last (hopefully newest) version.")
    version <- files[[n_files]]
  }

  path <- file.path(path, version, "bin", "Hostx86", "x86")

  if (!dir.exists(path)) {
    stop("Microsoft Visual Studio tools directory is incorrect or missing.")
  }

  normalizePath(path, mustWork = TRUE)
}

# Get the Visual Studio tools directory where `dumpbin.exe` and `lib.exe` live
path <- get_visual_studio_tools_directory()

# Put the path containing the tools on the PATH.
Sys.setenv(PATH = paste(path, Sys.getenv("PATH"), sep = ";"))

# Find R DLLs.
dlls <- list.files(R.home("bin"), pattern = "dll$", full.names = TRUE)

message("Generating .lib files for DLLs in ", R.home("bin"))

# Generate corresponding 'lib' file for each DLL.
for (dll in dlls) {

  # Check to see if we've already generated our exports
  def <- sub("dll$", "def", dll)
  if (file.exists(def))
    next

  # Call it on R.dll to generate exports.
  command <- sprintf("dumpbin.exe /EXPORTS /NOLOGO %s", dll)
  message("> ", command)
  output <- system(paste(command), intern = TRUE)

  # Remove synonyms.
  output <- sub("=.*$", "", output)

  # Find start, end markers
  start <- grep("ordinal\\s+hint\\s+RVA\\s+name", output)
  end <- grep("^\\s*Summary\\s*$", output)
  contents <- output[start:(end - 1)]
  contents <- contents[nzchar(contents)]

  # Remove forwarded fields (not certain that this does anything)
  contents <- grep("forwarded to", contents, invert = TRUE, value = TRUE, fixed = TRUE)

  # Parse into a table
  tbl <- read.table(text = contents, header = TRUE, stringsAsFactors = FALSE)
  exports <- tbl$name

  # Sort and re-format exports
  exports <- sort(exports)
  exports <- c("EXPORTS", paste("\t", tbl$name, sep = ""))

  # Write the exports to a def file
  def <- sub("dll$", "def", dll)
  cat(exports, file = def, sep = "\n")

  # Call 'lib.exe' to generate the library file.
  outfile <- sub("dll$", "lib", dll)
  fmt <- "lib.exe /def:%s /out:%s /machine:%s"
  cmd <- sprintf(fmt, def, outfile, .Platform$r_arch)
  system(cmd)

}
