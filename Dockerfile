# =============================================================================
# TEVA HQ / VirtOffice — Virtual agent office dashboard
# JorahOne
#
# Serves the static 3D office dashboard with the live agent-state API.
# Uses only the Python standard library — no pip dependencies required.
#
# Container networking:
#   The server defaults to 127.0.0.1 and refuses non-loopback binds. Inside the
#   container network we opt in explicitly with TEVA_ALLOW_NON_LOOPBACK=1 and
#   HOST=0.0.0.0; docker-compose publishes the host port on 127.0.0.1 only, so
#   the local-only fence still holds on the host.
# =============================================================================
FROM python:3.11-alpine

WORKDIR /app

# Copy application (scripts/ is required: registry, events, messages, state)
COPY server.py ./
COPY scripts/ ./scripts/
COPY public/ ./public/

# Container-only explicit opt-in for binding all interfaces inside the container
ENV HOST=0.0.0.0 \
    PORT=9502 \
    TEVA_ALLOW_NON_LOOPBACK=1

# agents.json placeholder: without it the server runs demo mode; mount a real
# file over /app/agents.json (see docker-compose.yml) for file mode.
RUN touch agents.json

EXPOSE 9502

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import os, urllib.request; urllib.request.urlopen('http://localhost:%s/api/config' % os.environ.get('PORT', '9502'), timeout=5)" || exit 1

CMD ["python3", "server.py"]
