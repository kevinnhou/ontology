import logging
import os
import socket
import threading
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .pipeline import run_pipeline
from .schemas import ProcessRequest

logging.basicConfig(level=logging.INFO)

_POLL_TIMEOUT = httpx.Timeout(30.0)
_DEFAULT_POLL_INTERVAL_SECONDS = 5.0


def _cors_origins() -> list[str]:
    raw = "http://localhost:3001,http://localhost:3000"
    return [o.strip() for o in raw.split(",") if o.strip()]


def _worker_config() -> tuple[str, str, str] | None:
    convex_site_url = os.environ.get("CONVEX_SITE_URL")
    callback_secret = os.environ.get("VISION_CALLBACK_SECRET")
    if not convex_site_url or not callback_secret:
        return None

    worker_id = os.environ.get("VISION_WORKER_ID")
    if not worker_id:
        worker_id = f"vision-{socket.gethostname()}-{uuid.uuid4().hex}"
    return convex_site_url.rstrip("/"), callback_secret, worker_id


def _poll_interval_seconds() -> float:
    raw = os.environ.get(
        "VISION_POLL_INTERVAL_SECONDS",
        str(_DEFAULT_POLL_INTERVAL_SECONDS),
    )
    try:
        return max(1.0, float(raw))
    except ValueError:
        return _DEFAULT_POLL_INTERVAL_SECONDS


def _poll_once(site_url: str, secret: str, worker_id: str) -> None:
    response = httpx.post(
        f"{site_url}/vision/claim",
        json={"workerId": worker_id},
        headers={"Authorization": f"Bearer {secret}"},
        timeout=_POLL_TIMEOUT,
    )
    if response.status_code == 204:
        return
    response.raise_for_status()
    request = ProcessRequest.model_validate(response.json())
    run_pipeline(request)


def _worker_loop(
    stop_event: threading.Event,
    site_url: str,
    secret: str,
    worker_id: str,
) -> None:
    interval = _poll_interval_seconds()
    logger = logging.getLogger(__name__)
    logger.info("vision worker %s started", worker_id)

    while not stop_event.is_set():
        try:
            _poll_once(site_url, secret, worker_id)
        except httpx.HTTPError:
            logger.exception("vision worker polling failed")
        except Exception:
            logger.exception("vision worker encountered an unexpected error")
        stop_event.wait(interval)

    logger.info("vision worker %s stopped", worker_id)


def ontology() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        config = _worker_config()
        stop_event: threading.Event | None = None
        worker_thread: threading.Thread | None = None

        if config:
            site_url, secret, worker_id = config
            stop_event = threading.Event()
            worker_thread = threading.Thread(
                target=_worker_loop,
                args=(stop_event, site_url, secret, worker_id),
                daemon=True,
                name="vision-worker",
            )
            worker_thread.start()
        else:
            logging.getLogger(__name__).warning(
                "vision worker is disabled; set CONVEX_SITE_URL and "
                "VISION_CALLBACK_SECRET to enable polling"
            )

        try:
            yield
        finally:
            if stop_event and worker_thread:
                stop_event.set()
                worker_thread.join(timeout=10)

    application = FastAPI(
        title="Ontology",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/")
    def root() -> dict[str, str]:
        return {}

    return application


app = ontology()


def run_dev() -> None:
    uvicorn.run("vision.main:app", host="0.0.0.0", port=8000, reload=False)
