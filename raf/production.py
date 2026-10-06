"""Production entry point; TLS and proxy-wide limits belong at the edge."""
import os
from waitress import serve
from .server import create_app

if __name__ == "__main__":
    serve(create_app(), host=os.getenv("RAF_HOST","0.0.0.0"),
          port=int(os.getenv("PORT","8000")), threads=4,
          max_request_body_size=12000, channel_timeout=30,
          clear_untrusted_proxy_headers=True)
