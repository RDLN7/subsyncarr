#!/bin/bash
# Add cron job to user crontab
echo "${CRON_SCHEDULE} cd /app && /usr/local/bin/node /app/dist/index.js >> /var/log/subsyncarr/cron.log 2>&1" | crontab -

# Run the initial instance of the app
node dist/index.js
mkdir -p /app/logs/
touch /app/logs/app.log
tail -f /app/logs/app.log
