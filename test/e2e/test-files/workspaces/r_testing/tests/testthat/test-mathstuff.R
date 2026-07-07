describe("top-level describe with describe inside", {
  describe("nested describe 1", {
    it("can 'add' two numbers", {
      expect_equal(1 + 1, addition(1, 1))
      #expect_equal('a', 'b')
    })
  })
  testthat::describe("nested describe 2", {
    it("can multiply two numbers", {
      expect_equal(10 * 2, multiplication(10, 2))
    })
    it("can handle division by 0", {
      skip("Testing a skip")
    })
  })
})

describe("matrix()", {
  it("can be multiplied by a scalar", {
    m1 <- matrix(1:4, 2, 2)
    m2 <- m1 * 2
    expect_equal(matrix(1:4 * 2, 2, 2), m2)
  })
  it("is true", {
    expect_true(TRUE)
  })
})

describe("addition()", {
  it("can add two numbers", {
    expect_equal(1 + 1, addition(1, 1))
  })
})

describe("multiplication()", {
   it("can multiply two numbers", {
     expect_equal(10 * 2, multiplication(10, 2))
   })
   it("a second it()", {
    expect_length(month.abb, 12)
   })
})
