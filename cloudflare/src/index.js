import {
  handleFeeders,
} from "./api/feeders.js";

import {
  handleHealth,
} from "./api/health.js";

import {
  handleOutages,
} from "./api/outages.js";

import {
  jsonResponse,
} from "./api/respond.js";

import {
  handleStatus,
} from "./api/status.js";

import {
  handleMoreFacebookIngest,
} from "./api/more-facebook-ingest.js";

import {
  collectNgcpUpdates,
} from "./collectors/ngcp.js";

import {
  consumeQueue,
} from "./queue/consumer.js";

import {
  handlePreflight,
} from "./security/cors.js";

import {
  createD1Store,
} from "./storage/d1.js";

import {
  createRawArchive,
} from "./storage/r2.js";

function context(env) {
  return {
    env,

    store:
      createD1Store(
        env.DB
      ),

    archive:
      createRawArchive(
        env.RAW_SOURCES
      ),
  };
}

async function route(
  request,
  env
) {
  if (
    request.method ===
    "OPTIONS"
  ) {
    return handlePreflight(
      request,
      env
    );
  }

  const url =
    new URL(
      request.url
    );

  const {
    store,
    archive,
  } = context(env);

  /*
   * Private GitHub Actions
   * ingestion endpoint.
   *
   * This is intentionally handled
   * before the GET-only public API.
   */
  if (
    url.pathname ===
    "/internal/ingest/more-facebook"
  ) {
    return handleMoreFacebookIngest(
      request,
      env,
      store,
      archive
    );
  }

  /*
   * Everything below remains
   * public read-only API.
   */
  if (
    request.method !==
    "GET"
  ) {
    return jsonResponse(
      request,
      env,
      {
        error:
          "METHOD_NOT_ALLOWED",
      },
      {
        status:
          405,

        headers: {
          Allow:
            "GET, OPTIONS",
        },
      }
    );
  }

  const parts =
    url.pathname
      .split("/")
      .filter(Boolean);

  if (
    url.pathname ===
    "/api/health"
  ) {
    return handleHealth(
      request,
      env,
      store,
      archive
    );
  }

  if (
    url.pathname ===
    "/api/status"
  ) {
    return handleStatus(
      request,
      env,
      store
    );
  }

  if (
    url.pathname ===
    "/api/outages"
  ) {
    return handleOutages(
      request,
      env,
      store
    );
  }

  if (
    parts[0] ===
      "api" &&
    parts[1] ===
      "outages" &&
    parts[2]
  ) {
    return handleOutages(
      request,
      env,
      store,
      decodeURIComponent(
        parts[2]
      )
    );
  }

  if (
    url.pathname ===
    "/api/feeders"
  ) {
    return handleFeeders(
      request,
      env
    );
  }

  if (
    parts[0] ===
      "api" &&
    parts[1] ===
      "feeders" &&
    parts[2]
  ) {
    return handleFeeders(
      request,
      env,
      decodeURIComponent(
        parts[2]
      )
    );
  }

  return jsonResponse(
    request,
    env,
    {
      error:
        "NOT_FOUND",
    },
    {
      status:
        404,
    }
  );
}

export default {
  fetch(
    request,
    env
  ) {
    return route(
      request,
      env
    );
  },

  scheduled(
    _controller,
    env,
    execution
  ) {
    const {
      store,
      archive,
    } = context(
      env
    );

    execution.waitUntil(
      collectNgcpUpdates({
        env,
        store,
        archive,

        queue:
          env.INGESTION_QUEUE,
      })
    );
  },

  queue(
    batch,
    env,
    execution
  ) {
    const {
      store,
      archive,
    } = context(
      env
    );

    execution.waitUntil(
      consumeQueue(
        batch,
        {
          env,
          store,
          archive,
        }
      )
    );
  },
};