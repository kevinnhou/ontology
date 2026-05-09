import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def _cors_origins() -> list[str]:
    raw = "http://localhost:3001,http://localhost:3000"
    return [o.strip() for o in raw.split(",") if o.strip()]


def ontology() -> FastAPI:
    application = FastAPI(
        title="Ontology",
        version="0.1.0",
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
