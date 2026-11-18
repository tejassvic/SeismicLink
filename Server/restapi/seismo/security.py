"""Small dependency-free password hashing and signed admin tokens."""
import base64, hashlib, hmac, json, os, time

SECRET = os.getenv('JWT_SECRET', 'replace-this-secret-before-deployment').encode()

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 240_000)
    return base64.urlsafe_b64encode(salt + digest).decode()

def verify_password(password: str, encoded: str) -> bool:
    try:
        raw = base64.urlsafe_b64decode(encoded.encode())
        salt, expected = raw[:16], raw[16:]
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 240_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False

def create_token(username: str, ttl: int = 60 * 60 * 12) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({'sub': username, 'exp': int(time.time()) + ttl}).encode()).decode().rstrip('=')
    signature = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return payload + '.' + signature

def read_token(token: str) -> str | None:
    try:
        payload, signature = token.rsplit('.', 1)
        expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected): return None
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if data['exp'] < time.time(): return None
        return data['sub']
    except Exception:
        return None
