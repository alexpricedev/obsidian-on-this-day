# Bun runtime + git (the base image ships neither git nor a CA bundle by default,
# both of which the vault clone over HTTPS needs).
FROM oven/bun:1

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# No runtime dependencies today, but keep install in place for when there are.
COPY package.json ./
RUN bun install --production || true

COPY . .

# Run once to completion; the process exits cleanly so Railway can schedule the
# next cron run (an overlapping/never-exiting run would be skipped).
CMD ["bun", "run", "src/index.ts"]
