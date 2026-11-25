"""The database connection and schema."""

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "undercover.db"

RESET = """
DROP TABLE IF EXISTS company;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS add_ons;
DROP TABLE IF EXISTS handlers;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS policies;
DROP TABLE IF EXISTS claims;

CREATE TABLE company (id INTEGER PRIMARY KEY CHECK (id = 1), record TEXT NOT NULL);
CREATE TABLE plans (plan TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE add_ons (add_on TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE handlers (handler_id TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE customers (customer_id TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE policies (policy_id TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE claims (
    claim_id TEXT PRIMARY KEY,
    record TEXT NOT NULL,
    status TEXT NOT NULL,
    decision TEXT,
    sign_off TEXT,
    payment TEXT
);
"""


def path() -> Path:
    """Return the database file, from UNDERCOVER_DB or the default."""
    return Path(os.getenv("UNDERCOVER_DB", DEFAULT_PATH))


def connect() -> sqlite3.Connection:
    """Open a connection whose rows can be read by column name."""
    conn = sqlite3.connect(path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[None]:
    """Hold the write lock while a step checks a claim and changes it."""
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        yield
