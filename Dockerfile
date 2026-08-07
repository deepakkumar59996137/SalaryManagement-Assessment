# Portable image, for any host that takes a container.
#
# Not used by the Render blueprint, which builds from source — this exists so
# the deployment is not tied to one provider.
#
# Single stage on purpose. A multi-stage build would shed the dev dependencies,
# but `better-sqlite3` is a native module and `tsx` is needed by the boot
# script, so the pruning saves less than the added fragility costs.

FROM node:22-bookworm-slim

# better-sqlite3 ships prebuilt binaries for this platform; python3 and build
# tooling are here only so `npm ci` can fall back to compiling if a prebuild is
# ever unavailable for the running architecture.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of source.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Where the SQLite file lives. Mount a volume here and the data persists;
# without one this directory is part of the container and is lost on restart.
ENV DATABASE_PATH=/data/acme-salary.db

RUN mkdir -p /data

# Deliberately no VOLUME directive: Railway and most hosts mount their own
# volume at this path, and an anonymous Docker volume declared here would only
# add a second, confusing one on hosts that honour it.

EXPOSE 3000

# Migrate, seed if empty, then serve.
#
# The host chooses the port — Railway, Fly and Render all inject PORT — so it is
# read at runtime rather than baked in, with a local default. Binding 0.0.0.0
# rather than localhost is what makes the container reachable from outside it.
CMD ["sh", "-c", "npm run boot && npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
