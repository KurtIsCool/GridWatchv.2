import fs from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.GRIDWATCH_INGEST_URL ||
  "http://localhost:8787/internal/ingest/more-facebook";

const SECRET =
  process.env.FACEBOOK_INGEST_SECRET;

const DOWNLOAD_ROOT =
  path.resolve("facebook-downloads");

if (!SECRET) {
  console.error(
    "FACEBOOK_INGEST_SECRET is not configured."
  );

  process.exit(1);
}

console.log(
  "Starting GridWatch Facebook ingestion..."
);

console.log(
  `Endpoint: ${API_URL}`
);

/* =========================================================
 * LOAD SCRAPED POSTS
 * ========================================================= */

async function loadPosts() {
  let entries;

  try {
    entries =
      await fs.readdir(
        DOWNLOAD_ROOT,
        {
          withFileTypes: true,
        }
      );
  } catch {
    throw new Error(
      "facebook-downloads/ does not exist."
    );
  }

  const directories =
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(
            "pfbid"
          )
      )
      .map(
        (entry) =>
          path.join(
            DOWNLOAD_ROOT,
            entry.name
          )
      );

  const posts = [];

  for (const directory of directories) {
    const postPath =
      path.join(
        directory,
        "post.json"
      );

    try {
      const raw =
        await fs.readFile(
          postPath,
          "utf8"
        );

      const post =
        JSON.parse(raw);

      posts.push({
        directory,
        post,
      });
    } catch (error) {
      console.error(
        `Skipping invalid post directory: ${directory}`
      );

      console.error(
        error.message
      );
    }
  }

  return posts;
}

/* =========================================================
 * BUILD INGESTION PAYLOAD
 * ========================================================= */

async function buildPayload({
  directory,
  post,
}) {
  const media = [];

  for (
    const item of
    post.media || []
  ) {
    if (!item.filename) {
      throw new Error(
        `Media for ${post.externalId} has no downloaded filename.`
      );
    }

    const imagePath =
      path.join(
        directory,
        item.filename
      );

    const bytes =
      await fs.readFile(
        imagePath
      );

    media.push({
      mimeType:
        item.mimeType,

      sha256:
        item.sha256,

      width:
        item.width,

      height:
        item.height,

      alt:
        item.alt || "",

      dataBase64:
        bytes.toString(
          "base64"
        ),
    });
  }

  return {
    externalId:
      post.externalId,

    url:
      post.url,

    caption:
      post.caption,

    published:
      post.published ||
      null,

    media,
  };
}

/* =========================================================
 * SEND TO GRIDWATCH
 * ========================================================= */

async function ingestPost(
  payload
) {
  const response =
    await fetch(
      API_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${SECRET}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            payload
          ),
      }
    );

  const raw =
    await response.text();

  let result;

  try {
    result =
      JSON.parse(raw);
  } catch {
    result = {
      raw,
    };
  }

  /*
   * IMPORTANT:
   *
   * response.status is a NUMBER PROPERTY.
   * It is NOT response.status().
   *
   * response.ok is also a PROPERTY.
   */
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${raw}`
    );
  }

  return {
    httpStatus:
      response.status,

    ...result,
  };
}

/* =========================================================
 * MAIN
 * ========================================================= */

const posts =
  await loadPosts();

console.log(
  `Posts available for ingestion: ${posts.length}`
);

let newCount = 0;
let updatedCount = 0;
let unchangedCount = 0;
let failedCount = 0;

for (const item of posts) {
  const externalId =
    item.post.externalId;

  console.log("");

  console.log(
    `Sending ${externalId}...`
  );

  try {
    const payload =
      await buildPayload(
        item
      );

    console.log(
      `  Images: ${payload.media.length}`
    );

    const result =
      await ingestPost(
        payload
      );

    console.log(
      `  HTTP ${result.httpStatus}`
    );

    console.log(
      `  GridWatch: ${result.status}`
    );

    console.log(
      `  Revision: ${result.revision ?? "unknown"}`
    );

    console.log(
      `  Source item: ${result.sourceItemId ?? "unknown"}`
    );

    if (
      result.status ===
      "NEW"
    ) {
      newCount++;
    } else if (
      result.status ===
      "UPDATED"
    ) {
      updatedCount++;
    } else if (
      result.status ===
      "UNCHANGED"
    ) {
      unchangedCount++;
    }
  } catch (error) {
    failedCount++;

    console.error(
      `  FAILED: ${error.message}`
    );
  }
}

console.log("");

console.log(
  "=============================="
);

console.log(
  "GRIDWATCH INGESTION SUMMARY"
);

console.log(
  "=============================="
);

console.log(
  `NEW:       ${newCount}`
);

console.log(
  `UPDATED:   ${updatedCount}`
);

console.log(
  `UNCHANGED: ${unchangedCount}`
);

console.log(
  `FAILED:    ${failedCount}`
);

if (failedCount > 0) {
  process.exitCode = 1;
}