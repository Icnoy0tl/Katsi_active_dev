"""
Property tests + fuzz. Run: python3 tests_pesos.py
Each property corresponds to a theorem in the explanation.
"""
import math
import random

import weights_mision as w

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
    res = w.factors(profile, variable_types, cats)
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
    res2 = w.factors(profile, {v: variable_types[v] for v in vs}, cats)
    for v in vs:
        check(abs(res["variables"][v]["weight"] - res2["variables"][v]["weight"]) < 1e-6,
              f"fuzz#{t}: not invariant to permutation")
    # P8 invariance to profile scale (d -> c*d)
    c = random.choice([0.01, 3, 1000])
    res3 = w.factors({k: c * x for k, x in profile.items()}, variable_types, cats)
    for v in variable_types:
        check(abs(res["variables"][v]["weight"] - res3["variables"][v]["weight"]) < 1e-6,
              f"fuzz#{t}: not invariant to d scale")
    # P9 invariance to adding a category that no variable uses
    res4 = w.factors(profile, variable_types, cats + ["EMPTY"])
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
r_ = deg("uniform profile", w.VARIABLE_TYPES, {c: 1 for c in w.CATEGORIES}, w.CATEGORIES)
# mission demanding only one category WITHOUT variables -> even + flag
variable_types_ = {"a": {"A": 1}, "b": {"A": 1}}
r_ = w.factors({"Z": 1}, variable_types_, ["A", "Z"])
check(r_["no_affinity"] and all(abs(x["weight"] - .5) < 1e-12 for x in r_["variables"].values()),
      "no affinity: must be even")
# exact tie at the maximum (3 tied variables)
deg("max tie", {"a": {"A": 1}, "b": {"A": 1}, "c": {"A": 1}, "d": {"B": 1}}, {"A": .9, "B": .1}, ["A", "B"])
# near-tie (gap 1e-8, greater than EPS_TIE)
deg("near tie", {"a": {"A": 1}, "b": {"A": 1 - 1e-8, "B": 1e-8}, "c": {"B": 1}}, {"A": .5, "B": .5 - 1e-9 * 0}, ["A", "B"])
# profile with explicit zeros and a minimum weight category
deg("minimum weight", w.VARIABLE_TYPES, {"GEO": 1, "MEC": 1e-300}, w.CATEGORIES)
# one-hot profile (H=0) in each category
for c in w.CATEGORIES:
    deg(f"one-hot {c}", w.VARIABLE_TYPES, {c: 1}, w.CATEGORIES)
# the 4 project missions
for k, w in w.MISSIONS.items():
    deg(f"mission {k}", w.VARIABLE_TYPES, w, w.CATEGORIES)

# ---------------------------------------------------------------- invalid inputs
def must_fail(name, profile, variable_types=w.VARIABLE_TYPES, cats=w.CATEGORIES):
    try:
        w.factors(profile, variable_types, cats)
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
r = [v["affinity"] for v in w.factors(w.MISSIONS["rover"])["variables"].values()]
for b in [0.5, 2, 11, 40]:
    h = 1e-6
    num = (w.entropy(w.softmax(r, b + h)) - w.entropy(w.softmax(r, b - h))) / (2 * h)
    w = w.softmax(r, b)
    E = sum(x * y for x, y in zip(w, r))
    var = sum(x * (y - E) ** 2 for x, y in zip(w, r))
    check(abs(num - (-b * var)) < 1e-6, f"dH/dbeta at beta={b}: {num} vs {-b*var}")

print(f"{N_FUZZ} random cases + degenerate + invalid + dH/dbeta identity")
print("FAILURES:", len(failures))
for f in failures[:20]:
    print(" -", f)
raise SystemExit(1 if failures else 0)