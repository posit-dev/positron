# We want to check that a test run launched from the test explorer gets the same
# value for certain environment variables as in the R console or when tests are
# run via the "R: Test R Package in Terminal" command.
#
# This ENV-VARS.txt file can be interesting to look at during interactive
# development, using various methods to invoke the tests.

watched_env_vars <- c(
  # Contributed by the positron-environment extension, so not R-specific.
  "RSTUDIO_PANDOC",
  "SF_PARTNER",
  "SPARK_CONNECT_USER_AGENT",
  "JUPYTER_PREFER_ENV_PATH",

  # Contributed by positron-r, describing the R selected in the console.
  "PATH",
  "QUARTO_R",
  "JUPYTER_PATH",

  # Forwarded from the live R console session to test-running gestures.
  "TESTTHAT_MAX_FAILS",
  "LANG",

  # Tell cli to format its hyperlinks for Positron.
  "R_CLI_HYPERLINKS",
  "R_CLI_HYPERLINK_FILE_URL_FORMAT",
  "R_CLI_HYPERLINK_RUN",
  "R_CLI_HYPERLINK_RUN_URL_FORMAT",
  "R_CLI_HYPERLINK_HELP",
  "R_CLI_HYPERLINK_HELP_URL_FORMAT",
  "R_CLI_HYPERLINK_VIGNETTE",
  "R_CLI_HYPERLINK_VIGNETTE_URL_FORMAT"
)

exe <- function(name) {
  if (.Platform$OS.type == "windows") paste0(name, ".exe") else name
}

test_that("the environment of the test process is recorded", {
  # The test explorer discards stdout that isn't reporter JSON, so the only way
  # to see these values is to write them somewhere.
  values <- Sys.getenv(watched_env_vars, names = TRUE)
  writeLines(
    c(
      paste0("R.home(): ", R.home()),
      paste0(names(values), "=", values)
    ),
    "ENV-VARS.txt"
  )
  expect_true(file.exists("ENV-VARS.txt"))
})

test_that("the positron-environment extension's variables arrive", {
  # These environmentVariables.set defaults should always be set.
  expect_equal(Sys.getenv("SF_PARTNER"), "posit_positron")
  expect_equal(Sys.getenv("SPARK_CONNECT_USER_AGENT"), "posit-positron")
  expect_equal(Sys.getenv("JUPYTER_PREFER_ENV_PATH"), "1")

  # Since we don't currently bundle Quarto or Pandoc in a dev build,
  # RSTUDIO_PANDOC might not be set. Only assert if the value appears to be set.
  pandoc_dir <- Sys.getenv("RSTUDIO_PANDOC")
  if (pandoc_dir != "") {
    expect_true(file.exists(file.path(pandoc_dir, exe("pandoc"))))
  }
})

test_that("QUARTO_R points at the R running these tests", {
  # Positron sets QUARTO_R to the bin directory of the selected R, so that
  # `quarto render` uses the same R as the console.
  expect_equal(
    normalizePath(Sys.getenv("QUARTO_R"), mustWork = FALSE),
    normalizePath(R.home("bin"), mustWork = FALSE)
  )
})

test_that("PATH resolves R and Rscript to the R running these tests", {
  # Positron prepends the selected R's bin directory to PATH. Anything that
  # shells out to R (or Rscript) from inside a test should get the same R as the
  # test runner.
  bin_dir <- normalizePath(R.home("bin"), mustWork = FALSE)
  resolved <- normalizePath(
    dirname(Sys.which(c("R", "Rscript"))),
    mustWork = FALSE
  )
  expect_equal(resolved, rep(bin_dir, 2))
})

test_that("JUPYTER_PATH is set", {
  expect_true(nzchar(Sys.getenv("JUPYTER_PATH")))
})

test_that("the cli hyperlink variables are set", {
  expect_true(Sys.getenv("R_CLI_HYPERLINKS") %in% c("TRUE", "FALSE"))
  skip_if(
    Sys.getenv("R_CLI_HYPERLINKS") == "FALSE",
    "installed cli is too old for hyperlinks"
  )
  expect_match(Sys.getenv("R_CLI_HYPERLINK_FILE_URL_FORMAT"), "^positron://")
})

test_that("TESTTHAT_MAX_FAILS is forwarded from the console", {
  # Only meaningful if you have set it in the console, e.g. with
  # Sys.setenv(TESTTHAT_MAX_FAILS = 99), before running this file.
  max_fails <- Sys.getenv("TESTTHAT_MAX_FAILS")
  skip_if(!nzchar(max_fails), "TESTTHAT_MAX_FAILS is not set in the console")
  expect_match(max_fails, "^[0-9]+$")
})
