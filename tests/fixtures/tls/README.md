Test-only TLS material for the gRPC TLS / mTLS tests: a CA certificate (its key was discarded), a
server certificate for `localhost` / `127.0.0.1`, and a client certificate, all signed by that CA.
These keys protect nothing and must never be used outside the tests.
