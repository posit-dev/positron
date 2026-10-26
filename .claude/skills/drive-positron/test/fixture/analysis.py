# drive-positron smoke fixture: a few lines to run in the Python console.
values = [3, 1, 4, 1, 5, 9, 2, 6]


def double_it(n):
    return n * 2


total = sum(double_it(v) for v in values)
print("smoke-total", total)
