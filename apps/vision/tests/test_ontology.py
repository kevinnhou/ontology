from fastapi.testclient import TestClient

from vision.main import app

client = TestClient(app)
