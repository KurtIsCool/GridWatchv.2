export function requireOperator(request, env) {
  if (env.GRIDWATCH_ENV !== "development") {
    return new Response("Not found", {
      status: 404,
    });
  }

  const configured =
    env.OPERATOR_DEV_TOKEN;

  if (!configured) {
    return new Response(
      "Operator endpoint disabled",
      {
        status: 503,
      }
    );
  }

  const supplied =
    request.headers
      .get("Authorization")
      ?.replace(
        /^Bearer\s+/i,
        ""
      );

  return supplied === configured
    ? null
    : new Response(
        "Unauthorized",
        {
          status: 401,
        }
      );
}

/*
 * Authentication specifically for automated
 * GitHub -> GridWatch source ingestion.
 *
 * Unlike requireOperator(), this is intended
 * to work in production.
 */
export function requireIngestion(
  request,
  env
) {
  const configured =
    String(
      env.FACEBOOK_INGEST_SECRET ||
        ""
    ).trim();

  if (!configured) {
    return new Response(
      "Ingestion endpoint disabled",
      {
        status: 503,
      }
    );
  }

  const supplied =
    request.headers
      .get("Authorization")
      ?.replace(
        /^Bearer\s+/i,
        ""
      )
      ?.trim();

  if (
    !supplied ||
    supplied !== configured
  ) {
    return new Response(
      "Unauthorized",
      {
        status: 401,
      }
    );
  }

  return null;
}