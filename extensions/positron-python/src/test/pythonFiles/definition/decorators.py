def identity(ob):
    return ob

@identity
def myfunc():
    print "my function"

myfunc()

# https://github.com/DonJayamanne/pythonVSCode/issues/1046
from fabric.api import sudo
# currently go to definition of sudo will go to some decorator function 
# works, if fabric package is not installed
sudo()

from numba import jit

# https://github.com/DonJayamanne/pythonVSCode/issues/478 
@jit()
def calculate_cash_flows(remaining_loan_term, remaining_io_term,
                         settle_balance, settle_date, payment_day, 
                         ir_fixed, ir_accrual_day_count_basis,
                         amortizing_debt_service):
    print("")

# currently go to definition of sudo will go to some decorator function 
# works, if fabric package is not installed
calculate_cash_flows(1,2,3,4,5,6,7,8)
