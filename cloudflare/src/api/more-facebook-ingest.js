import {
  createSourceItem,
  rawObjectKey,
} from "../ingestion/source-item.js";

import {
  sha256Hex,
  stableJson,
} from "../utils/hash.js";

import {
  requireIngestion,
} from "../security/auth.js";

import {
  canEnqueue,
  recordBudgetLimit,
  recordUsage,
} from "../budget/usage.js";

const PUBLISHER =
  "MORE Power";

const SOURCE_TYPE =
  "MORE_POWER_FACEBOOK_POST";

const FACEBOOK_IMAGE_SOURCE_TYPE =
  "MORE_POWER_FACEBOOK_IMAGE";

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

const RETRYABLE_QUEUE_STATUSES =
  new Set([
    "COLLECTED",
    "QUEUE_NOT_CONNECTED",
    "WAITING_FOR_QUEUE_BUDGET",
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

function imageEvidenceUrl(
  sourceUrl,
  imageNumber
) {
  const url =
    new URL(sourceUrl);

  url.hash =
    `image-${String(
      imageNumber
    ).padStart(2, "0")}`;

  return url.toString();
}

async function enqueueSource({
  env,
  store,
  sourceItem,
  revision,
  now,
}) {
  const budget =
    await canEnqueue(
      store,
      env,
      now
    );

  if (!budget.ok) {
    await store.markSourceStatus(
      sourceItem.id,
      "WAITING_FOR_QUEUE_BUDGET"
    );

    await recordBudgetLimit(
      store,
      "QUEUE",
      budget,
      now
    );

    return {
      status:
        "BUDGET_LIMIT_REACHED",

      sourceItemId:
        sourceItem.id,

      revision,
    };
  }

  if (
    !env.INGESTION_QUEUE
      ?.send
  ) {
    await store.markSourceStatus(
      sourceItem.id,
      "QUEUE_NOT_CONNECTED"
    );

    return {
      status:
        "NOT_CONNECTED",

      sourceItemId:
        sourceItem.id,

      revision,
    };
  }

  await env.INGESTION_QUEUE.send({
    sourceId:
      sourceItem.id,

    revision,
  });

  await recordUsage(
    store,
    {
      queue_operations:
        3,
    },
    now
  );

  await store.markSourceStatus(
    sourceItem.id,
    "QUEUED"
  );

  return {
    status:
      "QUEUED",

    sourceItemId:
      sourceItem.id,

    revision,
  };
}

/*
 * Every Facebook advisory image gets its own source item.
 *
 * The image source points to the already archived R2 object.
 * We do NOT upload a duplicate copy.
 *
 * A composite content hash is used so the same image reused
 * in two different Facebook posts remains distinct evidence.
 */
async function ensureFacebookImageSource({
  env,
  store,
  parentExternalId,
  parentSourceUrl,
  media,
  index,
  now,
}) {
  const imageNumber =
    index + 1;

  const imageExternalId =
    `${parentExternalId}:image:${String(
      imageNumber
    ).padStart(
      2,
      "0"
    )}`;

  const imageSourceUrl =
    imageEvidenceUrl(
      parentSourceUrl,
      imageNumber
    );

  const imageContentHash =
    await sha256Hex(
      stableJson({
        facebookExternalId:
          parentExternalId,

        imageNumber,

        imageSha256:
          media.sha256,
      })
    );

  const imageSource =
    await createSourceItem(
      {
        publisher:
          PUBLISHER,

        sourceType:
          FACEBOOK_IMAGE_SOURCE_TYPE,

        sourceUrl:
          imageSourceUrl,

        externalId:
          imageExternalId,

        contentHash:
          imageContentHash,

        rawObjectKey:
          media.objectKey,

        publishedAt:
          null,

        retrievedAt:
          now,
      },
      now
    );

  const existing =
    await store.findSourceMatch(
      imageSource
    );

  if (
    existing &&
    existing.content_hash ===
      imageContentHash
  ) {
    if (
      RETRYABLE_QUEUE_STATUSES.has(
        existing.processing_status
      )
    ) {
      return enqueueSource({
        env,
        store,

        sourceItem:
          existing,

        revision:
          existing.current_revision ||
          1,

        now,
      });
    }

    return {
      status:
        "UNCHANGED",

      sourceItemId:
        existing.id,

      revision:
        existing.current_revision ||
        1,
    };
  }

  const saved =
    await store.upsertSource(
      imageSource
    );

  return enqueueSource({
    env,
    store,

    sourceItem:
      saved.item,

    revision:
      saved.revision,

    now,
  });
}

async function ensureFacebookImageSources({
  env,
  store,
  parentExternalId,
  parentSourceUrl,
  media,
  now,
}) {
  const results = [];

  for (
    let i = 0;
    i < media.length;
    i++
  ) {
    const result =
      await ensureFacebookImageSource({
        env,
        store,

        parentExternalId,
        parentSourceUrl,

        media:
          media[i],

        index:
          i,

        now,
      });

    results.push({
      imageNumber:
        i + 1,

      ...result,
    });
  }

  return results;
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

        publishedAt:
          null,

        retrievedAt:
          now,
      },
      now
    );

  const existing =
    await store.findSourceMatch(
      source
    );

  /*
   * The parent may already have been stored before
   * image extraction was connected.
   *
   * Even when the parent is UNCHANGED, create any
   * missing image source records and enqueue them.
   *
   * R2 keys are deterministic, so this does not
   * upload duplicate image bytes.
   */
  if (
    existing &&
    existing.content_hash ===
      contentHash
  ) {
    const archivedMedia =
      verifiedMedia.map(
        (media, index) => {
          const filename =
            safeFilename(
              index,
              media.mimeType
            );

          return {
            filename,

            objectKey:
              rawObjectKey(
                source,
                filename
              ),

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
          };
        }
      );

    const imageSources =
      await ensureFacebookImageSources({
        env,
        store,

        parentExternalId:
          externalId,

        parentSourceUrl:
          sourceUrl,

        media:
          archivedMedia,

        now,
      });

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

      imageSources,
    });
  }

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

  source.raw_object_key =
    manifestArchive.key;

  source.inline_content =
    manifestText;

  const saved =
    await store.upsertSource(
      source
    );

  /*
   * Create image evidence source items and enqueue them.
   *
   * The queue consumer will run AI extraction, but
   * Facebook-derived image candidates are forced into
   * REVIEW_REQUIRED for now. They cannot auto-publish.
   */
  const imageSources =
    await ensureFacebookImageSources({
      env,
      store,

      parentExternalId:
        externalId,

      parentSourceUrl:
        sourceUrl,

      media:
        archivedMedia,

      now,
    });

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

      imageSources,
    },
    saved.created
      ? 201
      : 200
  );
}
