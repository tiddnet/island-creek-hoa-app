#!/usr/bin/env python3
"""
One-time (or re-run-on-change) seed of the `roster` Firestore collection
from a local, private JSON file -- keeps real owner names/addresses out of
this public repo entirely.

Requires firestore.rules to already be published (roster is currently
world-writable during the bootstrap phase -- see the TODO in that file).

Usage:
    python3 scripts/seed_roster.py --project-id island-creek-hoa-xxxxx \
        --source ~/git/island-creek-hoa/data/directory.json
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path


def slugify(address: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", address.lower()).strip("-")


def to_firestore_fields(doc: dict) -> dict:
    fields = {}
    for k, v in doc.items():
        if v is None:
            fields[k] = {"nullValue": None}
        elif isinstance(v, bool):
            fields[k] = {"booleanValue": v}
        elif isinstance(v, int):
            fields[k] = {"integerValue": str(v)}
        else:
            fields[k] = {"stringValue": str(v)}
    return {"fields": fields}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-id", required=True)
    ap.add_argument(
        "--source",
        default=str(Path.home() / "git" / "island-creek-hoa" / "data" / "directory.json"),
        help="Local (private, never committed here) directory.json from the "
             "island-creek-hoa repo.",
    )
    args = ap.parse_args()

    data = json.loads(Path(args.source).expanduser().read_text())
    parcels = [p for p in data["parcels"] if not p["is_hoa_common"]]
    parcels.sort(key=lambda p: -p["lat"])  # north -> south, same as directory

    base_url = f"https://firestore.googleapis.com/v1/projects/{args.project_id}/databases/(default)/documents/roster"

    for order, p in enumerate(parcels):
        address = p["address"].title()
        owner = " & ".join(x.title() for x in [p["owner1"], p["owner2"]] if x)
        listing = p.get("listing")
        house = listing["property_name"] if listing else None

        doc_id = slugify(address)
        body = to_firestore_fields({
            "address": address,
            "owner": owner,
            "house": house,
            "order": order,
        })
        req = urllib.request.Request(
            f"{base_url}/{doc_id}",
            data=json.dumps(body).encode(),
            method="PATCH",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
            print(f"  [{order:2d}] {address:26s} -> roster/{doc_id}")
        except urllib.error.HTTPError as e:
            print(f"  FAILED {address}: {e.code} {e.read().decode()}")
            raise

    print(f"\nSeeded {len(parcels)} roster documents to project {args.project_id}.")


if __name__ == "__main__":
    main()
