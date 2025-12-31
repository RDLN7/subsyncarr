#!/bin/bash

# Default to 1000 if not set
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Setting up user with UID: $PUID, GID: $PGID"

# Modify user/group to match PUID/PGID
if [ "$(id -u)" = "0" ]; then
    groupmod -o -g "$PGID" node
    usermod -o -u "$PUID" -g "$PGID" node
    
    # Fix permissions for app directory
    chown -R node:node /app
    chown -R node:node /home/node
    
    # Create and own log directory
    mkdir -p /var/log/subsyncarr
    touch /var/log/subsyncarr/cron.log
    chown -R node:node /var/log/subsyncarr
    
    # Start cron daemon as root
    service cron start
    
    # Run the application as the 'node' user
    exec gosu node bash -c '
        echo "Setting up crontab for user node..."
        echo "'"${CRON_SCHEDULE}"' cd /app && /usr/local/bin/node /app/dist/index.js >> /var/log/subsyncarr/cron.log 2>&1" | crontab -
        
        echo "Running initial instance..."
        # Run in background to allow tailing logs immediately
        node dist/index.js >> /var/log/subsyncarr/cron.log 2>&1 &
        
        echo "Tailing logs..."
        tail -f /var/log/subsyncarr/cron.log
    '
else
    # Fallback for non-root execution (not expected in this setup)
    echo "Container running as non-root. Skipping user modification."
    node dist/index.js
fi
