from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


def _cors_origins() -> list[str]:
    raw = "http://localhost:3001,http://localhost:3000"
    return [o.strip() for o in raw.split(",") if o.strip()]


def ontology() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        yield

    application = FastAPI(
        title="Ontology",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.worker_ready = False
    application.state.worker_status = "starting"
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

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/readiness")
    def readiness() -> JSONResponse:
        ready = bool(application.state.worker_ready)
        status = "ready" if ready else str(application.state.worker_status)
        return JSONResponse(
            {"ready": ready, "status": status},
            status_code=200 if ready else 503,
        )

    return application


app = ontology()


def run_dev() -> None:
    uvicorn.run("vision.main:app", host="0.0.0.0", port=8000, reload=False)
