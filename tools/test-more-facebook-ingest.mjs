import fs from "node:fs/promises";
import path from "node:path";

const API_URL =
  "http://localhost:8787/internal/ingest/more-facebook";

const SECRET =
  process.env.FACEBOOK_INGEST_SECRET;

const DOWNLOAD_ROOT =
  path.resolve("facebook-downloads");

if (!SECRET) {
  console.error(
    "Missing FACEBOOK_INGEST_SECRET environment variable."
  );

  console.error(
    'PowerShell example:'
  );

  console.error(
    '$env:FACEBOOK_INGEST_SECRET="gridwatch-local-facebook-test-2026"'
  );

  process.exit(1);
}

async function findPostDirectory() {
  const entries =
    await fs.readdir(
      DOWNLOAD_ROOT,
      {
        withFileTypes: true,
      }
    );

  const postDirectories =
    entries.filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(
          "pfbid"
        )
    );

  if (
    postDirectories.length === 0
  ) {
    throw new Error(
      "No Facebook post folders found in facebook-downloads/"
    );
  }

  return path.join(
    DOWNLOAD_ROOT,
    postDirectories[0].name
  );
}

async function main() {
  const postDirectory =
    await findPostDirectory();

  const postPath =
    path.join(
      postDirectory,
      "post.json"
    );

  console.log(
    `Using: ${postPath}`
  );

  const post =
    JSON.parse(
      await fs.readFile(
        postPath,
        "utf8"
      )
    );

  const media = [];

  for (
    const item of post.media || []
  ) {
    if (!item.filename) {
      console.log(
        "Skipping media without downloaded filename."
      );

      continue;
    }

    const imagePath =
      path.join(
        postDirectory,
        item.filename
      );

    const bytes =
      await fs.readFile(
        imagePath
      );

    console.log(
      `Loading ${item.filename} (${bytes.length} bytes)`
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

  const payload = {
    externalId:
      post.externalId,

    url:
      post.url,

    caption:
      post.caption,

    published:
      post.published || null,

    media,
  };

  console.log("");
  console.log(
    `Sending ${payload.externalId}`
  );

  console.log(
    `Media items: ${media.length}`
  );

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

  const text =
    await response.text();

  console.log("");
  console.log(
    `HTTP ${response.status}`
  );

  console.log(text);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    console.error(
      "Test failed:"
    );

    console.error(error);

    process.exit(1);
  }
);