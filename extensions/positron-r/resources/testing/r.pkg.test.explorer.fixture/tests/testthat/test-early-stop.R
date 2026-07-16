test_that("runs before the stop", {
  expect_true(TRUE)
})

# The e2e test drops a "STOP" sentinel in tests/testthat/ so this top-level
# stop() ends the file early, leaving the test below unrun.
if (file.exists("STOP")) {
  stop("stopping before the rest of the file")
}

test_that("runs after the stop", {
  expect_true(TRUE)
})
