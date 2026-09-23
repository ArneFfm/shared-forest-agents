"""Shared Forest SDK. Zero dependencies (urllib only).

Read the forest, plant a tree, sponsor custom trees.
API reference: https://sharedforest.com/openapi.json
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

__all__ = ["DEFAULT_BASE_URL", "SharedForestClient", "SharedForestError", "WorldForestClient", "WorldForestError"]
__version__ = "0.1.0"

DEFAULT_BASE_URL = "https://sharedforest.com"


class SharedForestError(Exception):
    """An API error. `problem` holds the RFC 9457 problem+json body when the server sent one."""

    def __init__(self, status, problem=None, message=None):
        detail = (problem or {}).get("detail") if isinstance(problem, dict) else None
        super().__init__(message or detail or "Shared Forest API answered HTTP %d" % status)
        self.status = status
        self.problem = problem if isinstance(problem, dict) else None


def _default_transport(method, url, headers, body, timeout):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


class SharedForestClient:
    """Client for the Shared Forest REST API (version 1).

    `transport(method, url, headers, body, timeout) -> (status, bytes)` replaces urllib in tests.
    """

    def __init__(self, base_url=DEFAULT_BASE_URL, timeout=30.0, transport=None, user_agent=None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport or _default_transport
        self.user_agent = user_agent or "shared-forest-sdk-python/" + __version__

    def request(self, method, path, query=None, body=None, idempotency_key=None):
        url = self.base_url + path
        params = {k: v for k, v in (query or {}).items() if v is not None}
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Accept": "application/json", "User-Agent": self.user_agent}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        status, raw = self.transport(method, url, headers, data, self.timeout)
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        if status >= 400:
            raise SharedForestError(status, parsed)
        return parsed

    def get_forest(self, limit=None, cursor=None, bbox=None):
        """Live snapshot. Pass limit, cursor or bbox (minX, minY, maxX, maxY) for one page."""
        box = ",".join(str(n) for n in bbox) if bbox else None
        return self.request("GET", "/api/v1/forest", {"limit": limit, "cursor": cursor, "bbox": box})

    def list_trees(self, limit=100, cursor=None, bbox=None):
        """One page of trees. Pass nextCursor as cursor until it is None."""
        return self.get_forest(limit=limit, cursor=cursor, bbox=bbox)

    def plant(self, idempotency_key=None):
        """Plants one tree (one per visitor per day). Call it only when the user asks."""
        return self.request("POST", "/api/v1/visit", body={"plant": True}, idempotency_key=idempotency_key)

    def quote(self, quantity):
        """Price of N sponsored trees for 12 months, euro cents, VAT included."""
        return self.request("GET", "/api/v1/pricing/quote", {"quantity": quantity})

    def design_tree(self, wish):
        """Designs a tree from a wish (1-200 characters). Max 3 per caller per day."""
        return self.request("POST", "/api/v1/designs", body={"wish": wish})

    def find_spots(self, quantity, near=None):
        """Free spots for N sponsored trees, optionally near (x, y)."""
        return self.request("GET", "/api/v1/spots", {"quantity": quantity, "near": "%s,%s" % tuple(near) if near else None})

    def start_sponsorship(self, quantity, design_ids, display_name, email, idempotency_key, spots=None, hold_ids=None, link=None):
        """Creates an unpaid order and returns it with confirmUrl.

        Give confirmUrl to the human buyer: only the buyer can accept the terms and pay.
        With `spots` ([{"x": .., "y": ..}]) the SDK holds them first.
        """
        if not idempotency_key:
            raise ValueError("idempotency_key is required, for example str(uuid.uuid4()).")
        holds = hold_ids
        if spots:
            held = self.request("POST", "/api/v1/holds", body={"spots": list(spots)}, idempotency_key=idempotency_key + ":holds")
            if held.get("rejected"):
                reasons = "; ".join("(%s, %s) %s" % (r["x"], r["y"], r["reason"]) for r in held["rejected"])
                raise SharedForestError(409, None, "Spots not free: " + reasons)
            holds = [h["id"] for h in held["holds"]]
        body = {"quantity": quantity, "designIds": list(design_ids), "displayName": display_name, "email": email, "channel": "api"}
        if holds:
            body["holdIds"] = holds
        if link:
            body["link"] = link
        try:
            return self.request("POST", "/api/v1/orders", body=body, idempotency_key=idempotency_key)
        except SharedForestError:
            # Free the spots this call held, so they do not count against the hold cap.
            if spots:
                for hold_id in holds:
                    try:
                        self.release_hold(hold_id)
                    except SharedForestError:
                        pass
            raise

    def get_order(self, order_id):
        return self.request("GET", "/api/v1/orders/" + urllib.parse.quote(order_id, safe=""))

    def extend_order(self, order_id):
        """An agent order expires 30 minutes after creation unless the human confirms. Adds 30 minutes, once."""
        return self.request("POST", "/api/v1/orders/" + urllib.parse.quote(order_id, safe="") + "/extend")

    def release_hold(self, hold_id):
        """Frees a held spot (the per-IP cap is 100 held spots)."""
        self.request("DELETE", "/api/v1/holds/" + urllib.parse.quote(hold_id, safe=""))

    def wait_for_order(self, order_id, interval=10.0, timeout=35 * 60, sleep=time.sleep):
        """Polls get_order until the order leaves "open" and "paid", or the timeout passes."""
        deadline = time.monotonic() + timeout
        while True:
            order = self.get_order(order_id)
            if order["status"] not in ("open", "paid"):
                return order
            if time.monotonic() + interval > deadline:
                raise SharedForestError(408, None, "Order %s is still %s after %s s." % (order_id, order["status"], timeout))
            sleep(max(interval, 1.0))


# Names before the rename to Shared Forest.
WorldForestClient = SharedForestClient
WorldForestError = SharedForestError
