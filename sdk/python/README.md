# shared-forest

Zero-dependency Python client for the [Shared Forest](https://world.ghardenlab.com/) API.
Standard library only (`urllib`). Python 3.9+.

The package is not on PyPI yet. Install it from this repository:

```sh
pip install "git+https://github.com/ArneFfm/shared-forest-agents#subdirectory=sdk/python"
```

## Use

```python
import uuid
from shared_forest import SharedForestClient

forest = SharedForestClient()
page = forest.list_trees(limit=50)

# Sponsor 5 trees for a user. The user confirms and pays on confirmUrl.
quote = forest.quote(5)
design = forest.design_tree("a silver birch with warm lanterns")
spots = forest.find_spots(5, near=(4096, 4096))["spots"]
order = forest.start_sponsorship(5, [design["id"]], "Ada", "ada@example.com", str(uuid.uuid4()), spots=spots)
print("Total %.2f EUR. Confirm and pay: %s" % (quote["total"] / 100, order["confirmUrl"]))
done = forest.wait_for_order(order["id"])
```

Methods: `get_forest`, `list_trees`, `plant`, `quote`, `design_tree`, `find_spots`, `start_sponsorship`, `get_order`, `extend_order`, `release_hold`, `wait_for_order`.

An agent order expires 30 minutes after creation unless the human confirms. `extend_order` adds 30 minutes once.

An agent cannot pay for a consumer: German consumer law needs the buyer's own confirmation.
Errors raise `SharedForestError` with `status` and the problem+json body in `problem`.

## Test

```sh
python -m unittest discover -s tests
```
