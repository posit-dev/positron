test_that("test_that number 1 passes", {
  expect_equal(2 * 2, 4)
})

test_that("test_that number 2 fails", {
  expect_equal(2 * 2, 3)
})
