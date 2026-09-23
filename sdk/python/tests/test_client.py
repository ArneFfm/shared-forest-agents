import json
import unittest
import urllib.parse

from shared_forest import SharedForestClient, SharedForestError

ORDER = {
    "id": "ord_test1", "status": "open", "quantity": 2, "unitAmount": 900, "total": 1800, "currency": "eur",
    "channel": "api", "checkoutUrl": None, "confirmUrl": "https://forest.example/sponsor/confirm/ord_test1",
    "treeIds": [], "createdAt": 1, "paidAt": None,
}


class Stub:
    """Transport stub: records requests, answers from a route table."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        u = urllib.parse.urlsplit(url)
        self.calls.append({"method": method, "path": u.path, "query": u.query, "headers": headers, "body": json.loads(body) if body else None})
        handler = self.routes.get(method + " " + u.path)
        if not handler:
            return 404, json.dumps({"type": "about:blank", "title": "Not Found", "status": 404, "detail": "nope"}).encode()
        status, payload = handler(self.calls[-1])
        return status, json.dumps(payload).encode()


def client(routes):
    stub = Stub(routes)
    return stub, SharedForestClient(base_url="https://forest.example/", transport=stub)


class ClientTest(unittest.TestCase):
    def test_forest_and_trees(self):
        stub, c = client({"GET /api/v1/forest": lambda r: (200, {"trees": [], "nextCursor": None})})
        c.get_forest()
        c.list_trees(limit=5, cursor="abc", bbox=(0, 0, 10, 10))
        self.assertEqual(stub.calls[0]["query"], "")
        self.assertEqual(stub.calls[1]["query"], "limit=5&cursor=abc&bbox=0%2C0%2C10%2C10")

    def test_plant(self):
        stub, c = client({"POST /api/v1/visit": lambda r: (200, {"queued": True, "visitId": "v", "plant": True})})
        self.assertEqual(c.plant(idempotency_key="k1")["visitId"], "v")
        self.assertEqual(stub.calls[0]["body"], {"plant": True})
        self.assertEqual(stub.calls[0]["headers"]["Idempotency-Key"], "k1")

    def test_quote_design_spots(self):
        stub, c = client({
            "GET /api/v1/pricing/quote": lambda r: (200, {"quantity": 5, "total": 3900}),
            "POST /api/v1/designs": lambda r: (200, {"id": "dsn_1"}),
            "GET /api/v1/spots": lambda r: (200, {"spots": [{"x": 1, "y": 2}]}),
        })
        self.assertEqual(c.quote(5)["total"], 3900)
        self.assertEqual(c.design_tree("a birch")["id"], "dsn_1")
        c.find_spots(2, near=(4000, 4100))
        self.assertEqual(stub.calls[0]["query"], "quantity=5")
        self.assertEqual(stub.calls[1]["body"], {"wish": "a birch"})
        self.assertEqual(stub.calls[2]["query"], "quantity=2&near=4000%2C4100")

    def test_start_sponsorship_holds_then_orders(self):
        stub, c = client({
            "POST /api/v1/holds": lambda r: (200, {"holds": [{"id": "hld_%d" % i} for i, _ in enumerate(r["body"]["spots"])], "rejected": []}),
            "POST /api/v1/orders": lambda r: (200, ORDER),
        })
        order = c.start_sponsorship(2, ["dsn_1"], "Ada", "a@b.co", "k", spots=[{"x": 1, "y": 2}, {"x": 3, "y": 4}])
        self.assertEqual(order["confirmUrl"], ORDER["confirmUrl"])
        self.assertEqual(stub.calls[0]["headers"]["Idempotency-Key"], "k:holds")
        self.assertEqual(stub.calls[1]["body"]["holdIds"], ["hld_0", "hld_1"])
        self.assertEqual(stub.calls[1]["body"]["channel"], "api")
        self.assertNotIn("link", stub.calls[1]["body"])
        with self.assertRaises(ValueError):
            c.start_sponsorship(1, ["dsn_1"], "A", "a@b.co", "")

    def test_errors(self):
        stub, c = client({"POST /api/v1/holds": lambda r: (200, {"holds": [], "rejected": [{"x": 1, "y": 2, "reason": "water"}]})})
        with self.assertRaises(SharedForestError) as ctx:
            c.start_sponsorship(1, ["dsn_1"], "A", "a@b.co", "k", spots=[{"x": 1, "y": 2}])
        self.assertEqual(ctx.exception.status, 409)
        self.assertIn("water", str(ctx.exception))
        with self.assertRaises(SharedForestError) as ctx:
            c.get_order("ord_missing")
        self.assertEqual(ctx.exception.status, 404)
        self.assertEqual(ctx.exception.problem["detail"], "nope")

    def test_extend_release_and_cleanup(self):
        stub, c = client({
            "POST /api/v1/orders/ord_test1/extend": lambda r: (200, ORDER),
            "DELETE /api/v1/holds/hld_0": lambda r: (204, None),
            "POST /api/v1/holds": lambda r: (201, {"holds": [{"id": "hld_0"}], "rejected": []}),
            "POST /api/v1/orders": lambda r: (429, {"status": 429, "detail": "3 open orders per email"}),
        })
        self.assertEqual(c.extend_order("ord_test1")["id"], "ord_test1")
        self.assertIsNone(c.release_hold("hld_0"))
        with self.assertRaises(SharedForestError) as ctx:
            c.start_sponsorship(1, ["dsn_1"], "A", "a@b.co", "k", spots=[{"x": 1, "y": 2}])
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual([call["method"] + " " + call["path"] for call in stub.calls], [
            "POST /api/v1/orders/ord_test1/extend",
            "DELETE /api/v1/holds/hld_0",
            "POST /api/v1/holds",
            "POST /api/v1/orders",
            "DELETE /api/v1/holds/hld_0",
        ])

    def test_wait_for_order(self):
        states = ["open", "paid", "fulfilled"]
        stub, c = client({"GET /api/v1/orders/ord_test1": lambda r: (200, dict(ORDER, status=states.pop(0)))})
        slept = []
        self.assertEqual(c.wait_for_order("ord_test1", interval=0.01, sleep=slept.append)["status"], "fulfilled")
        self.assertEqual(slept, [1.0, 1.0])
        _, stuck = client({"GET /api/v1/orders/ord_test1": lambda r: (200, ORDER)})
        with self.assertRaises(SharedForestError) as ctx:
            stuck.wait_for_order("ord_test1", interval=5, timeout=0.001, sleep=lambda s: None)
        self.assertEqual(ctx.exception.status, 408)


class FormerNameTest(unittest.TestCase):
    def test_names_before_the_rename_still_import(self):
        import world_forest

        self.assertIs(world_forest.WorldForestClient, SharedForestClient)
        self.assertIs(world_forest.WorldForestError, SharedForestError)


if __name__ == "__main__":
    unittest.main()
