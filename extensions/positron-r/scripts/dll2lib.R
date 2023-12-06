# 2023-12-06
# At the time of writing, this script is for "manual" execution on Windows.
# For the moment, it is a one-time setup task for a specific R installation.
#
# Two key points:
# 1. You must be running R as an administrator to execute this script.
#    If, for example, you do this via RStudio, make sure to launch RStudio as an administrator.
# 2. Edit `path` to point to the correct version of the Visual Studio tools for your installation.

# `path` for Davis was slightly different than Jenny
# path <- "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.37.32822\\bin\\Hostx86\\x86"
path <- "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.38.33130\\bin\\Hostx86\\x86"
if (!dir.exists(path)) {
  stop("Visual Studio tools directory is incorrect or the tools have not been installed.")
}

# Put the path containing the tools on the PATH.
Sys.setenv(PATH = paste(path, Sys.getenv("PATH"), sep = ";"))

# Find R DLLs.
dlls <- list.files(R.home("bin"), pattern = "dll$", full.names = TRUE)

message("Generating .lib files for DLLs in ", R.home("bin"))

# Generate corresponding 'lib' file for each DLL.
for (dll in dlls) {

   # check to see if we've already generated our exports
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

   # parse into a table
   tbl <- read.table(text = contents, header = TRUE, stringsAsFactors = FALSE)
   exports <- tbl$name

   # sort and re-format exports
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
