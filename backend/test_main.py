from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_healthcheck():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_demo_login_returns_session():
    response = client.post('/api/auth/login', json={'dni': '12345678', 'password': 'demo'})
    assert response.status_code == 200
    assert response.json()['rol'] == 'Directora'


def test_invalid_login_is_rejected():
    response = client.post('/api/auth/login', json={'dni': '12345678', 'password': 'wrong'})
    assert response.status_code == 401


def test_dashboard_contract():
    response = client.get('/api/dashboard')
    body = response.json()
    assert response.status_code == 200
    assert {'cases', 'alerts', 'kpis', 'generatedAt'} <= body.keys()
    assert len(body['kpis']) == 4
