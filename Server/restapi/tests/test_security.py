from seismo.security import hash_password, verify_password, create_token, read_token

def test_password_hash_round_trip():
    encoded=hash_password('demo-secret')
    assert verify_password('demo-secret',encoded)
    assert not verify_password('wrong',encoded)

def test_token_round_trip():
    token=create_token('admin')
    assert read_token(token)=='admin'
