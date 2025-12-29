# Use Node.js LTS (Long Term Support) as base image
FROM node:20-bookworm

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
COPY --from=mwader/static-ffmpeg:latest /ffprobe /usr/local/bin/

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    cron \
    pipx \
    && rm -rf /var/lib/apt/lists/*

USER node
# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY --chown=node:node package*.json ./

# Add pipx to PATH
ENV PATH="/home/node/.local/bin:$PATH"

# Install ffsubsync and autosubsync using pipx
RUN pipx install ffsubsync \
    && pipx install autosubsync

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
