# Mathematical Proofs & Dynamic Unbiased Weight Calculation

## Disclaimer
Scripts in this dir are a mathematical and logical proof for the algorithm used to calculate the weight of variables. They are strictly mathematical proofs for the dynamic-unbiased calculation of weights based on variable types and mission demand profiles

---

## Short explanation
The program maps variables across 7 categories, where each variable defines its own internal probability distribution (composition) summing to 1. Similarly, each mission defines a demand profile across those categories. On top of this, rigorous mathematical algorithms (linear algebra for affinity, information theory with Shannon entropy, and numerical optimization via softmax and bisection) run to dynamically and unbiasedly calculate the final weights.

---

## What the Scripts Do

The codebase implements and rigorously tests a formal framework for calculating dynamic, unbiased weights for variables (such as terrain features, environmental parameters, and operational constraints) across different mission types (e.g., rover, EDL, habitat, water/bio research) without relying on specific regional data values[cite: 2, 3].

The calculation pipeline consists of three fundamental mathematical steps:

1. **F1 (Affinity Calculation - $r_j$):** 
   Uses Linear Algebra and Probability (dot products and cosine similarity) to measure how well each variable type aligns with the specific demand profile of a given mission[cite: 3].
2. **F2 (Weight Assignment via Softmax - $w_j$):** 
   Applies Constrained Optimization (Lagrange multipliers) and Information Theory (Maximum Entropy / Minimum Kullback-Leibler divergence) to derive weights that reflect the appropriate level of concentration or dispersion[cite: 3].
3. **F3 (Beta Calibration - $\beta$):** 
   Uses Calculus (derivatives, monotonicity, Intermediate Value Theorem) combined with Numerical Analysis (bisection method) to dynamically calibrate the inverse temperature parameter $\beta$ so that the effective number of elements ($N_{eff}$) matches the theoretically derived target ($N^*$)[cite: 3].

---

---

## What the Scripts Do

The codebase implements and rigorously tests a formal framework for calculating dynamic, unbiased weights for variables (such as terrain features, environmental parameters, and operational constraints) across different mission types (e.g., rover, EDL, habitat, water/bio research) without relying on specific regional data values

The calculation pipeline consists of three fundamental mathematical steps:

1. **F1 (Affinity Calculation - $r_j$):** 
   Uses Linear Algebra and Probability (dot products and cosine similarity) to measure how well each variable type aligns with the specific demand profile of a given mission
2. **F2 (Weight Assignment via Softmax - $w_j$):** 
   Applies Constrained Optimization (Lagrange multipliers) and Information Theory (Maximum Entropy / Minimum Kullback-Leibler divergence) to derive weights that reflect the appropriate level of concentration or dispersion
3. **F3 (Beta Calibration - $\beta$):** 
   Uses Calculus (derivatives, monotonicity, Intermediate Value Theorem) combined with Numerical Analysis (bisection method) to dynamically calibrate the inverse temperature parameter $\beta$ so that the effective number of elements ($N_{eff}$) matches the theoretically derived target ($N^*$)

---

## How It Works

* **`weights_mision.py`:** Contains the core mathematical definitions, probability distributions of variable categories (`VARIABLE_TYPES`), mission demand profiles (`MISSIONS`), statistical tools (Shannon entropy, effective number, softmax with numerical stability via log-sum-exp trick), and the calibration engine
* **`tests_weights.py`:** Executes thousands of automated fuzzing iterations, property tests corresponding to formal theorems, degenerate edge cases, invalid input checks, and mathematical identity verifications (such as confirming the derivative of entropy with respect to beta matches the weighted variance

## Requirements & Dependencies
No external libraries or databases are required. The project relies solely on Python's standard library (`math`, `random`, `json`), making it lightweight, self-contained, and runnable out of the box.