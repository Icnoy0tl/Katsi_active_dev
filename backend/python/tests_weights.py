
"""

Property tests + fuzz. Run: python3 tests_pesos.py
Each property corresponds to a theorem in the explanation.

"""

import math
import random
 
import weights_mision as wm
 
random.seed(7)
failures = []
 
 
def check(cond, msg):
    if not cond:
        failures.append(msg)
 
 
def dirichlet(k, alpha):
    g = [random.gammavariate(alpha, 1) for _ in range(k)]
    s = sum(g)
    return [x / s for x in g]
 
 
def random_case():
    C = random.randint(1, 12)
    n = random.randint(1, 60)
    cats = [f"c{i}" for i in range(C)]
    variable_types = {}
    for j in range(n):
        mode = random.choice(["pure", "mix", "two"])
        if mode == "pure":
            row = {random.choice(cats): 1.0}
        elif mode == "two":
            a, b = random.choice(cats), random.choice(cats)
            t = random.random()
            row = {a: t}
            row[b] = row.get(b, 0) + (1 - t)
        else:
            row = dict(zip(cats, dirichlet(C, random.choice([0.2, 1, 5]))))
        variable_types[f"v{j}"] = row
    k = random.randint(1, C)
    chosen = random.sample(cats, k)
    profile = dict(zip(chosen, dirichlet(k, random.choice([0.1, 1, 10]))))
    return variable_types, profile, cats
 
 
def properties(variable_types, profile, cats, label):
    res = wm.factors(profile, variable_types, cats)
    v = res["variables"]
    w = [x["weight"] for x in v.values()]
    f = [x["factor"] for x in v.values()]
    r = [x["affinity"] for x in v.values()]
    n = len(w)
 
    # P1 valid weights: finite, >=0, sum to 1; factors with mean 1
    check(all(math.isfinite(x) and x >= 0 for x in w), f"{label}: non-finite/negative weight")
    check(abs(sum(w) - 1) < 1e-12, f"{label}: sum {sum(w)}")
    check(abs(sum(f) / n - 1) < 1e-12, f"{label}: factor mean")
    # P2 convergence
    check(res["converged"], f"{label}: did not converge")
    # P3 affinity in [0,1]
    check(all(-1e-12 <= x <= 1 + 1e-12 for x in r), f"{label}: r outside [0,1]")
    # P4 effective_n reaches target (or is n if there was nothing to concentrate)
    if res["beta"] > 0:
        check(abs(res["effective_n"] - res["target_n"]) <= 1e-6 * n,
              f"{label}: effective_n {res['effective_n']} != {res['target_n']}")
    else:
        check(abs(res["effective_n"] - n) < 1e-9, f"{label}: beta=0 but effective_n != n")
    # P5 monotonicity: higher affinity => greater-or-equal weight; tie => equal weight
    for i in range(n):
        for j in range(n):
            if r[i] > r[j] + 1e-9:
                check(w[i] >= w[j], f"{label}: monotonicity")
            if abs(r[i] - r[j]) <= 1e-12:
                check(abs(w[i] - w[j]) < 1e-9, f"{label}: unequal tie")
    # P6 angle in [0, acos(sqrt(1/n))]... bound: acos(1/sqrt n)
    check(-1e-9 <= res["angle_deg"] <= math.degrees(math.acos(1 / math.sqrt(n))) + 1e-6,
          f"{label}: angle out of range")
    return res
 
 
# ---------------------------------------------------------------- random fuzz
N_FUZZ = 4000
for t in range(N_FUZZ):
    variable_types, profile, cats = random_case()
    res = properties(variable_types, profile, cats, f"fuzz#{t}")
 
    # P7 invariance to permuting variables
    vs = list(variable_types)
    random.shuffle(vs)
    res2 = wm.factors(profile, {v: variable_types[v] for v in vs}, cats)
    for v in vs:
        check(abs(res["variables"][v]["weight"] - res2["variables"][v]["weight"]) < 1e-6,
              f"fuzz#{t}: not invariant to permutation")
    # P8 invariance to profile scale (d -> c*d)
    c = random.choice([0.01, 3, 1000])
    res3 = wm.factors({k: c * x for k, x in profile.items()}, variable_types, cats)
    for v in variable_types:
        check(abs(res["variables"][v]["weight"] - res3["variables"][v]["weight"]) < 1e-6,
              f"fuzz#{t}: not invariant to d scale")
    # P9 invariance to adding a category that no variable uses
    res4 = wm.factors(profile, variable_types, cats + ["EMPTY"])
    for v in variable_types:
        check(abs(res["variables"][v]["weight"] - res4["variables"][v]["weight"]) < 1e-9,
              f"fuzz#{t}: changes when adding empty category")
 
# ---------------------------------------------------------------- degenerate cases
def deg(name, variable_types, profile, cats):
    return properties(variable_types, profile, cats, name)
 
# n=1
deg("n=1", {"a": {"X": 1}}, {"X": 1}, ["X"])
# C=1
deg("C=1", {"a": {"X": 1}, "b": {"X": 1}}, {"X": 5}, ["X"])
# all variables identical -> even weights
r_ = deg("equal variable_types", {f"v{i}": {"A": .5, "B": .5} for i in range(10)}, {"A": 1}, ["A", "B"])
check(all(abs(x["weight"] - .1) < 1e-12 for x in r_["variables"].values()), "equal variable_types: not even")
# uniform profile over symmetric categories -> beta=0, even
r_ = deg("uniform profile", wm.VARIABLE_TYPES, {c: 1 for c in wm.CATEGORIES}, wm.CATEGORIES)
# mission demanding only one category WITHOUT variables -> even + flag
variable_types_ = {"a": {"A": 1}, "b": {"A": 1}}
r_ = wm.factors({"Z": 1}, variable_types_, ["A", "Z"])
check(r_["no_affinity"] and all(abs(x["weight"] - .5) < 1e-12 for x in r_["variables"].values()),
      "no affinity: must be even")
# exact tie at the maximum (3 tied variables)
deg("max tie", {"a": {"A": 1}, "b": {"A": 1}, "c": {"A": 1}, "d": {"B": 1}}, {"A": .9, "B": .1}, ["A", "B"])
# near-tie (gap 1e-8, greater than EPS_TIE)
deg("near tie", {"a": {"A": 1}, "b": {"A": 1 - 1e-8, "B": 1e-8}, "c": {"B": 1}}, {"A": .5, "B": .5 - 1e-9 * 0}, ["A", "B"])
# profile with explicit zeros and a minimum weight category
deg("minimum weight", wm.VARIABLE_TYPES, {"GEO": 1, "MEC": 1e-300}, wm.CATEGORIES)
# one-hot profile (H=0) in each category
for c in wm.CATEGORIES:
    deg(f"one-hot {c}", wm.VARIABLE_TYPES, {c: 1}, wm.CATEGORIES)
# the project missions
for k, prof in wm.MISSIONS.items():
    deg(f"mission {k}", wm.VARIABLE_TYPES, prof, wm.CATEGORIES)
 
# ---------------------------------------------------------------- invalid inputs
def must_fail(name, profile, variable_types=wm.VARIABLE_TYPES, cats=wm.CATEGORIES):
    try:
        wm.factors(profile, variable_types, cats)
    except ValueError:
        return
    failures.append(f"{name}: should have raised ValueError")
 
must_fail("misspelled key", {"GEOO": 1})
must_fail("negative", {"GEO": -1, "MEC": 2})
must_fail("NaN", {"GEO": float("nan")})
must_fail("inf", {"GEO": float("inf")})
must_fail("sum zero", {"GEO": 0})
must_fail("empty profile", {})
must_fail("row variable_types does not sum to 1", {"GEO": 1}, variable_types={"a": {"GEO": .5}})
must_fail("variable_types without variables", {"GEO": 1}, variable_types={})
must_fail("variable_types with unknown category", {"GEO": 1}, variable_types={"a": {"QQ": 1}})
 
# ---------------------------------------------------------------- calculation identity
# dH/dbeta = -beta * Var_w(r)   (central finite difference vs formula)
r = [v["affinity"] for v in wm.factors(wm.MISSIONS["mobility"])["variables"].values()]
for b in [0.5, 2, 11, 40]:
    h = 1e-6
    num = (wm.entropy(wm.softmax(r, b + h)) - wm.entropy(wm.softmax(r, b - h))) / (2 * h)
    pw = wm.softmax(r, b)
    E = sum(x * y for x, y in zip(pw, r))
    var = sum(x * (y - E) ** 2 for x, y in zip(pw, r))
    check(abs(num - (-b * var)) < 1e-6, f"dH/dbeta at beta={b}: {num} vs {-b*var}")
 
 
# ---------------------------------------------------------------- F2' (model deployed in Go)
def f2prime(profile, mu, cats):
    """Reference for mission.go: w_j = sum_c mu_jc * d_c / n_c over used categories."""
    nc = {c: sum(mu[v].get(c, 0.0) for v in mu) for c in cats}
    used = [c for c in cats if nc[c] > 0]
    mass = sum(profile.get(c, 0.0) for c in used)
    n = len(mu)
    if mass <= 0:
        return {v: 1.0 / n for v in mu}, used, {}
    d = {c: profile.get(c, 0.0) / mass for c in used}
    wts = {v: sum(mu[v].get(c, 0.0) * d[c] / nc[c] for c in used) for v in mu}
    return wts, used, d
 
for t in range(N_FUZZ):
    variable_types, profile, cats = random_case()
    wts, used, d = f2prime(profile, variable_types, cats)
    vals = list(wts.values())
    # Q1 valid weights: finite, >= 0, sum to 1
    check(all(math.isfinite(x) and x >= 0 for x in vals), f"f2'#{t}: invalid weight")
    check(abs(sum(vals) - 1) < 1e-9, f"f2'#{t}: sum {sum(vals)}")
    if d:
        # Q2 category fidelity: total weight of category c equals d_c
        # direct form: sum_j q_jc = d_c with q_jc = mu_jc d_c / n_c
        nc = {c: sum(variable_types[v].get(c, 0.0) for v in variable_types) for c in used}
        for c in used:
            q = sum(variable_types[v].get(c, 0.0) * d[c] / nc[c] for v in variable_types)
            check(abs(q - d[c]) < 1e-9, f"f2'#{t}: category {c} gets {q}, demanded {d[c]}")
    # Q3 invariance to permuting variables
    vs = list(variable_types)
    random.shuffle(vs)
    wts2, _, _ = f2prime(profile, {v: variable_types[v] for v in vs}, cats)
    for v in vs:
        check(abs(wts[v] - wts2[v]) < 1e-12, f"f2'#{t}: not invariant to permutation")
    # Q4 invariance to profile scale
    c_ = random.choice([0.01, 3, 1000])
    wts3, _, _ = f2prime({k: c_ * x for k, x in profile.items()}, variable_types, cats)
    for v in vs:
        check(abs(wts[v] - wts3[v]) < 1e-9, f"f2'#{t}: not invariant to d scale")
    # Q5 invariance to adding a category no variable uses
    wts4, _, _ = f2prime(profile, variable_types, cats + ["EMPTY"])
    for v in vs:
        check(abs(wts[v] - wts4[v]) < 1e-12, f"f2'#{t}: changes with an empty category")
 
# deployed missions: weights valid and sum to 1
for k, prof in wm.MISSIONS.items():
    wts, _, _ = f2prime(prof, wm.VARIABLE_TYPES, wm.CATEGORIES)
    check(abs(sum(wts.values()) - 1) < 1e-12, f"F2' mission {k}: sum != 1")
    check(all(x >= 0 for x in wts.values()), f"F2' mission {k}: negative weight")
# mission demanding only a category without variables -> even weights
wts, _, _ = f2prime({"Z": 1}, {"a": {"A": 1}, "b": {"A": 1}}, ["A", "Z"])
check(all(abs(x - .5) < 1e-12 for x in wts.values()), "F2' no affinity: must be even")
 
print(f"{N_FUZZ} random cases + degenerate + invalid + dH/dbeta identity + F2' properties")
print("FAILURES:", len(failures))
for f in failures[:20]:
    print(" -", f)
raise SystemExit(1 if failures else 0)