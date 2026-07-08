import numpy as np
import matplotlib.pyplot as plt

# do this in the console
# %matplotlib widget

v = np.array([1,2])
w = np.array([4,-6])

fig, ax = plt.subplots()
plt.xlim(-6,6)
plt.ylim(-6,6)

plt.plot(v)
plt.plot(w)

plt.show()