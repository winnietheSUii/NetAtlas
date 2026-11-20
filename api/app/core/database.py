import asyncio
import logging
from typing import Any, Sequence

from fastapi import HTTPException
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import settings

logger = logging.getLogger(__name__)

_NETATLAS_DDL: tuple[str, ...] = (
    "CREATE SCHEMA IF NOT EXISTS netatlas;",
    """
    CREATE TABLE IF NOT EXISTS netatlas.sites (
        site_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_local BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS netatlas.agents (
        agent_id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES netatlas.sites(site_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        hostname TEXT,
        version TEXT,
        status TEXT NOT NULL DEFAULT 'registered',
        last_seen TIMESTAMPTZ,
        device_count INTEGER NOT NULL DEFAULT 0,
        link_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS netatlas.node_overrides (
        site_id TEXT NOT NULL DEFAULT 'local',
        ip TEXT NOT NULL,
        role_override TEXT,
        is_root BOOLEAN NOT NULL DEFAULT FALSE,
        pos_x DOUBLE PRECISION,
        pos_y DOUBLE PRECISION,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (site_id, ip)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS netatlas.ingested_snapshots (
        site_id TEXT PRIMARY KEY REFERENCES netatlas.sites(site_id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES netatlas.agents(agent_id) ON DELETE SET NULL,
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    """
    INSERT INTO netatlas.sites (site_id, name, description, is_local)
    VALUES ('local', 'Local Site', 'Primary Netdisco discovery engine', TRUE)
    ON CONFLICT (site_id) DO NOTHING;
    """,
)


class DatabaseManager:
    """Async PostgreSQL connection pool manager for Netdisco & NetAtlas schemas."""

    def __init__(self) -> None:
        self._pool: AsyncConnectionPool | None = None
        self._lock = asyncio.Lock()
        self._schema_ready = False

    def _build_conninfo(self) -> str:
        return make_conninfo(
            host=settings.netdisco_db_host,
            port=settings.netdisco_db_port,
            dbname=settings.netdisco_db_name,
            user=settings.netdisco_db_user,
            password=settings.netdisco_db_pass,
            connect_timeout=5,
        )

    async def _init_netatlas_schema(self, pool: AsyncConnectionPool) -> None:
        if self._schema_ready:
            return
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                for stmt in _NETATLAS_DDL:
                    await cur.execute(stmt)
            await conn.commit()
        self._schema_ready = True
        logger.info("Verified netatlas PostgreSQL schema and default local site.")

    async def startup(self) -> None:
        """Open connection pool on startup when running against live Netdisco DB."""
        if settings.mock_mode:
            logger.info("Starting NetAtlas API in MOCK_MODE=true (PostgreSQL pool skipped).")
            return
        try:
            await self.ensure_pool()
            logger.info(
                "Connected to Netdisco PostgreSQL at %s:%s/%s.",
                settings.netdisco_db_host,
                settings.netdisco_db_port,
                settings.netdisco_db_name,
            )
        except HTTPException as exc:
            logger.warning(
                "Netdisco PostgreSQL not ready on startup (%s). Will retry lazily.",
                exc.detail,
            )

    async def shutdown(self) -> None:
        """Close connection pool cleanly on application shutdown."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            self._schema_ready = False

    async def ensure_pool(self) -> AsyncConnectionPool:
        """Lazily open the connection pool and ensure NetAtlas schema exists."""
        if self._pool is not None and not self._pool.closed:
            if not self._schema_ready:
                await self._init_netatlas_schema(self._pool)
            return self._pool

        async with self._lock:
            if self._pool is not None and not self._pool.closed:
                if not self._schema_ready:
                    await self._init_netatlas_schema(self._pool)
                return self._pool

            pool = AsyncConnectionPool(
                conninfo=self._build_conninfo(),
                min_size=1,
                max_size=10,
                open=False,
                kwargs={"row_factory": dict_row},
            )
            try:
                await pool.open(wait=True, timeout=5.0)
                await self._init_netatlas_schema(pool)
            except Exception as exc:
                try:
                    await pool.close()
                except Exception:
                    pass
                raise HTTPException(
                    status_code=503,
                    detail=f"Netdisco PostgreSQL database unavailable: {exc}",
                ) from exc

            self._pool = pool
            return self._pool

    async def check_health(self) -> bool:
        """Return True if PostgreSQL responds to SELECT 1."""
        if settings.mock_mode:
            return False
        try:
            pool = await self.ensure_pool()
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT 1")
                    await cur.fetchone()
            return True
        except Exception as exc:
            logger.warning("Database health check failed: %s", exc)
            return False

    async def fetch_all(
        self, query: str, params: Sequence[Any] | None = None
    ) -> list[dict[str, Any]]:
        """Execute a parameterized SELECT query and return all rows as dicts."""
        pool = await self.ensure_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                rows = await cur.fetchall()
                return list(rows)

    async def fetch_one(
        self, query: str, params: Sequence[Any] | None = None
    ) -> dict[str, Any] | None:
        """Execute a parameterized SELECT query and return a single row or None."""
        pool = await self.ensure_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                return await cur.fetchone()

    async def execute(
        self, query: str, params: Sequence[Any] | None = None
    ) -> None:
        """Execute a parameterized write statement and commit."""
        pool = await self.ensure_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
            await conn.commit()

    async def execute_returning(
        self, query: str, params: Sequence[Any] | None = None
    ) -> dict[str, Any] | None:
        """Execute a parameterized INSERT/UPDATE ... RETURNING query."""
        pool = await self.ensure_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                row = await cur.fetchone()
            await conn.commit()
            return row


db = DatabaseManager()
