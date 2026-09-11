import {
  createSourceItem,
} from "../ingestion/source-item.js";

import {
  sha256Hex,
  stableJson,
} from "../utils/hash.js";

import {
  requireIngestion,
} from "../security/auth.js";

const PUBLISHER =
  "MORE Power";

const SOURCE_TYPE =
  "MORE_POWER_FACEBOOK_POST";

const MAX_MEDIA_ITEMS = 10;

const MAX_IMAGE_BYTES =
  5 * 1024 * 1024;

const MAX_TOTAL_BYTES =
  15 * 1024 * 1024;

const ALLOWED_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

function jsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",
      },
    }
  );
}

function badRequest(message) {
  return jsonResponse(
    {
      error:
        "INVALID_REQUEST",

      message,
    },
    400
  );
}

function decodeBase64(
  value
) {
  const raw =
    atob(value);

  const bytes =
    new Uint8Array(
      raw.length
    );

  for (
    let i = 0;
    i < raw.length;
    i++
  ) {
    bytes[i] =
      raw.charCodeAt(i);
  }

  return bytes;
}

function safeFilename(
  index,
  mimeType
) {
  const extension =
    mimeType ===
    "image/png"
      ? "png"
      : mimeType ===
          "image/webp"
        ? "webp"
        : "jpg";

  return `image-${String(
    index + 1
  ).padStart(
    2,
    "0"
  )}.${extension}`;
}

/*
 * Supported stable Facebook identities:
 *
 * pfbid...            regular Page post
 * video_123456789     Page video post
 * photo_123456789     Page photo evidence
 */
function isValidExternalId(
  externalId
) {
  return (
    /^pfbid[A-Za-z0-9]+$/.test(
      externalId
    ) ||
    /^video_\d+$/.test(
      externalId
    ) ||
    /^photo_\d+$/.test(
      externalId
    )
  );
}

function validateFacebookItemUrl(
  rawUrl,
  externalId
) {
  try {
    const url =
      new URL(rawUrl);

    const allowedHost =
      url.hostname ===
        "facebook.com" ||
      url.hostname ===
        "www.facebook.com";

    if (!allowedHost) {
      return false;
    }

    if (
      /^pfbid[A-Za-z0-9]+$/.test(
        externalId
      )
    ) {
      return (
        url.pathname.includes(
          "/MOREpowerIloilo/posts/"
        ) &&
        url.pathname.includes(
          externalId
        )
      );
    }

    const videoMatch =
      externalId.match(
        /^video_(\d+)$/
      );

    if (videoMatch) {
      return (
        url.pathname ===
          `/MOREpowerIloilo/videos/${videoMatch[1]}` ||
        url.pathname ===
          `/MOREpowerIloilo/videos/${videoMatch[1]}/`
      );
    }

    const photoMatch =
      externalId.match(
        /^photo_(\d+)$/
      );

    if (photoMatch) {
      const isPhotoPath =
        url.pathname ===
          "/photo/" ||
        url.pathname ===
          "/photo.php";

      return (
        isPhotoPath &&
        url.searchParams.get(
          "fbid"
        ) ===
          photoMatch[1]
      );
    }

    return false;
  } catch {
    return false;
  }
}

function canonicalRevisionData(
  payload
) {
  return {
    externalId:
      payload.externalId,

    url:
      payload.url,

    caption:
      payload.caption ||
      null,

    media:
      payload.media.map(
        (media) => ({
          sha256:
            media.sha256,

          mimeType:
            media.mimeType,

          width:
            media.width ||
            null,

          height:
            media.height ||
            null,
        })
      ),
  };
}

export async function handleMoreFacebookIngest(
  request,
  env,
  store,
  archive
) {
  if (
    request.method !== "POST"
  ) {
    return jsonResponse(
      {
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  /*
   * Authenticate before parsing
   * potentially large input.
   */
  const auth =
    requireIngestion(
      request,
      env
    );

  if (auth) {
    return auth;
  }

  const contentType =
    request.headers.get(
      "Content-Type"
    ) || "";

  if (
    !contentType.includes(
      "application/json"
    )
  ) {
    return badRequest(
      "Content-Type must be application/json."
    );
  }

  let payload;

  try {
    payload =
      await request.json();
  } catch {
    return badRequest(
      "Request body is not valid JSON."
    );
  }

  /*
   * -----------------------------
   * Validate Facebook identity
   * -----------------------------
   */

  const externalId =
    String(
      payload?.externalId ||
        ""
    ).trim();

  if (
    !isValidExternalId(
      externalId
    )
  ) {
    return badRequest(
      "Invalid Facebook externalId."
    );
  }

  const sourceUrl =
    String(
      payload?.url ||
        ""
    ).trim();

  if (
    !validateFacebookItemUrl(
      sourceUrl,
      externalId
    )
  ) {
    return badRequest(
      "Invalid MORE Power Facebook item URL."
    );
  }

  const caption =
    typeof payload.caption ===
    "string"
      ? payload.caption
          .trim()
          .slice(
            0,
            100000
          )
      : null;

  /*
   * -----------------------------
   * Validate media
   * -----------------------------
   */

  if (
    !Array.isArray(
      payload.media
    )
  ) {
    return badRequest(
      "media must be an array."
    );
  }

  if (
    payload.media.length >
    MAX_MEDIA_ITEMS
  ) {
    return badRequest(
      `Maximum media items is ${MAX_MEDIA_ITEMS}.`
    );
  }

  let totalBytes = 0;

  const verifiedMedia =
    [];

  for (
    let i = 0;
    i <
    payload.media.length;
    i++
  ) {
    const media =
      payload.media[i];

    const mimeType =
      String(
        media?.mimeType ||
          ""
      )
        .split(";")[0]
        .trim()
        .toLowerCase();

    if (
      !ALLOWED_TYPES.has(
        mimeType
      )
    ) {
      return badRequest(
        `Unsupported media type at index ${i}.`
      );
    }

    if (
      typeof media.dataBase64 !==
      "string"
    ) {
      return badRequest(
        `Missing image data at index ${i}.`
      );
    }

    let bytes;

    try {
      bytes =
        decodeBase64(
          media.dataBase64
        );
    } catch {
      return badRequest(
        `Invalid base64 image at index ${i}.`
      );
    }

    if (
      bytes.byteLength === 0
    ) {
      return badRequest(
        `Empty image at index ${i}.`
      );
    }

    if (
      bytes.byteLength >
      MAX_IMAGE_BYTES
    ) {
      return badRequest(
        `Image ${i + 1} exceeds the size limit.`
      );
    }

    totalBytes +=
      bytes.byteLength;

    if (
      totalBytes >
      MAX_TOTAL_BYTES
    ) {
      return badRequest(
        "Total image payload exceeds the size limit."
      );
    }

    const actualHash =
      await sha256Hex(
        bytes
      );

    const suppliedHash =
      String(
        media.sha256 ||
          ""
      ).toLowerCase();

    if (
      suppliedHash &&
      actualHash !==
        suppliedHash
    ) {
      return badRequest(
        `SHA-256 mismatch for image ${i + 1}.`
      );
    }

    verifiedMedia.push({
      bytes,

      sha256:
        actualHash,

      mimeType,

      width:
        Number(
          media.width
        ) || null,

      height:
        Number(
          media.height
        ) || null,

      alt:
        typeof media.alt ===
        "string"
          ? media.alt.slice(
              0,
              5000
            )
          : null,
    });
  }

  /*
   * Build the content hash ourselves.
   *
   * Do NOT use Facebook relative
   * timestamps such as "2h".
   */
  const revisionInput = {
    externalId,

    url:
      sourceUrl,

    caption,

    media:
      verifiedMedia.map(
        (media) => ({
          sha256:
            media.sha256,

          mimeType:
            media.mimeType,

          width:
            media.width,

          height:
            media.height,
        })
      ),
  };

  const contentHash =
    await sha256Hex(
      stableJson(
        revisionInput
      )
    );

  const now =
    new Date();

  /*
   * Create GridWatch's canonical
   * source identity.
   */
  const source =
    await createSourceItem(
      {
        publisher:
          PUBLISHER,

        sourceType:
          SOURCE_TYPE,

        sourceUrl,

        externalId,

        contentHash,

        content:
          stableJson(
            revisionInput
          ),

        /*
         * We currently only have
         * Facebook relative times,
         * so don't invent an exact
         * publishedAt value.
         */
        publishedAt:
          null,

        retrievedAt:
          now,
      },
      now
    );

  /*
   * Check D1 BEFORE writing anything.
   */
  const existing =
    await store.findSourceMatch(
      source
    );

  if (
    existing &&
    existing.content_hash ===
      contentHash
  ) {
    return jsonResponse({
      status:
        "UNCHANGED",

      externalId,

      sourceItemId:
        existing.id,

      revision:
        existing.current_revision ||
        1,

      contentHash,

      mediaCount:
        verifiedMedia.length,
    });
  }

  /*
   * -----------------------------
   * Store images in R2
   * -----------------------------
   */

  const archivedMedia =
    [];

  for (
    let i = 0;
    i <
    verifiedMedia.length;
    i++
  ) {
    const media =
      verifiedMedia[i];

    const filename =
      safeFilename(
        i,
        media.mimeType
      );

    const archived =
      await archive.put(
        source,
        media.bytes,
        {
          filename,

          contentType:
            media.mimeType,
        }
      );

    if (
      !archived.stored
    ) {
      return jsonResponse(
        {
          error:
            "R2_NOT_AVAILABLE",

          message:
            archived.reason ||
            "Unable to archive Facebook media.",
        },
        503
      );
    }

    archivedMedia.push({
      filename,

      objectKey:
        archived.key,

      sha256:
        media.sha256,

      mimeType:
        media.mimeType,

      width:
        media.width,

      height:
        media.height,

      alt:
        media.alt,
    });
  }

  /*
   * Manifest links the Facebook
   * item to every stored image.
   */
  const manifest = {
    source:
      "MORE_POWER_FACEBOOK",

    externalId,

    url:
      sourceUrl,

    caption,

    observedFacebookTimestamp:
      payload.published ||
      null,

    retrievedAt:
      now.toISOString(),

    contentHash,

    media:
      archivedMedia,
  };

  const manifestText =
    stableJson(
      manifest
    );

  /*
   * Archive the item manifest
   * itself in R2.
   */
  const manifestArchive =
    await archive.put(
      source,
      manifestText,
      {
        filename:
          "post.json",

        contentType:
          "application/json",
      }
    );

  if (
    !manifestArchive.stored
  ) {
    return jsonResponse(
      {
        error:
          "R2_NOT_AVAILABLE",

        message:
          manifestArchive.reason ||
          "Unable to archive Facebook manifest.",
      },
      503
    );
  }

  /*
   * D1 points to the manifest.
   */
  source.raw_object_key =
    manifestArchive.key;

  source.inline_content =
    manifestText;

  const saved =
    await store.upsertSource(
      source
    );

  /*
   * IMPORTANT:
   *
   * We intentionally DO NOT enqueue
   * this source yet.
   *
   * For this checkpoint we only:
   *
   * - authenticate
   * - deduplicate
   * - persist D1
   * - persist R2
   *
   * Extraction/publication comes later.
   */

  return jsonResponse(
    {
      status:
        saved.created
          ? "NEW"
          : "UPDATED",

      externalId,

      sourceItemId:
        saved.item.id,

      revision:
        saved.revision,

      contentHash,

      mediaCount:
        archivedMedia.length,

      manifestObjectKey:
        manifestArchive.key,
    },
    saved.created
      ? 201
      : 200
  );
}
