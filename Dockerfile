# Use Node.js LTS (Long Term Support) as base image
FROM node:20-bookworm-slim

# Create app user and group with configurable UID/GID
ENV PUID=1000
ENV PGID=1000

RUN mkdir -p /app
RUN chown node:node /app

# Modify existing node user instead of creating new one
RUN groupmod -g ${PGID} node && \
    usermod -u ${PUID} -g ${PGID} node && \
    chown -R node:node /home/node
RUN apt-get clean

# Install system dependencies including Python and cron (ffmpeg is copied from static image)
COPY --from=mwader/static-ffmpeg:latest /ffmpeg /usr/local/bin/

# Install system dependencies, create venv, install ffsubsync, and cleanup in one layer to minimize size
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    cron \
    gosu \
    build-essential \
    python3-dev \
    && python3 -m venv /app/venv \
    && /app/venv/bin/pip install --no-cache-dir ffsubsync \
    && find /app/venv -name "tests" -type d -exec rm -rf {} + \
    && find /app/venv -name "__pycache__" -type d -exec rm -rf {} + \
    && apt-get purge -y build-essential python3-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /app

ENV VIRTUAL_ENV=/app/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY --chown=node:node package*.json ./

# Install Node.js dependencies while skipping husky installation
ENV HUSKY=0
RUN npm install --ignore-scripts

# Install Node.js dependencies while skipping husky installation
ENV HUSKY=0
RUN npm install --ignore-scripts

# Copy the rest of your application
COPY --chown=node:node . .
RUN mkdir -p /home/node/.local/bin/
RUN cp bin/* /home/node/.local/bin/

# Build TypeScript
RUN npm run build

# Create startup script
# Set default cron schedule (if not provided by environment variable)
ENV CRON_SCHEDULE="0 0 * * *"

# Create startup script with proper permissions
# Copy startup script
COPY --chown=node:node startup.sh /app/startup.sh

# Make startup script executable
RUN chmod +x /app/startup.sh

# Use startup script as entrypoint
CMD ["/app/startup.sh"]
