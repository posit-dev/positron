describe("simple describe() 1 passes", {
   it("it number 1-1", {
     expect_equal(10 * 2, 20)
   })
   it("it number 1-2", {
    expect_length(month.abb, 12)
   })
})

describe("simple describe() 2 fails", {
   it("it number 2-1 fails", {
     expect_equal(10 * 2, 19)
   })
})
