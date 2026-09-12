import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  handleMoreFacebookIngest,
} from "../src/api/more-facebook-ingest.js";

import {
  processSourceMessage,
} from "../src/queue/consumer.js";

import {
  rawObjectKey,
} from "../src/ingestion/source-item.js";

import {
  createMemoryStore,
} from "../src/storage/memory.js";

import {
  sha256Hex,
} from "../src/utils/hash.js";

const fixtures =
  new URL(
    "../fixtures/",
    import.meta.url
  );

const load =
  (name) =>
    JSON.parse(
      fs.readFileSync(
        new URL(
          name,
          fixtures
        ),
        "utf8"
      )
    );

const now =
  new Date(
    "2026-09-11T09:00:00Z"
  );

function makeArchive() {
  const puts = [];

  return {
    puts,

    async put(
      source,
      body,
      {
        filename =
          "original.bin",
      } = {}
    ) {
      const key =
        rawObjectKey(
          source,
          filename
        );

      puts.push({
        sourceId:
          source.id,

        filename,

        key,

        body,
      });

      return {
        stored:
          true,

        key,
      };
    },

    async get() {
      return new TextEncoder()
        .encode(
          "fake image bytes"
        )
        .buffer;
    },
  };
}

async function makePayload() {
  const bytes =
    new TextEncoder()
      .encode(
        "fake jpeg bytes"
      );

  const hash =
    await sha256Hex(
      bytes
    );

  return {
    payload: {
      externalId:
        "pfbidFacebookBridge123",

      url:
        "https://www.facebook.com/MOREpowerIloilo/posts/pfbidFacebookBridge123",

      caption:
        "MORE POWER ADVISORY",

      published: {
        text:
          "1h",
      },

      media: [
        {
          mimeType:
            "image/jpeg",

          sha256:
            hash,

          width:
            1200,

          height:
            900,

          alt:
            "Advisory",

          dataBase64:
            Buffer
              .from(
                bytes
              )
              .toString(
                "base64"
              ),
        },
      ],
    },

    bytes,
  };
}

function makeRequest(
  payload
) {
  return new Request(
    "https://gridwatch.example.test/internal/ingest/more-facebook",
    {
      method:
        "POST",

      headers: {
        Authorization:
          "Bearer test-secret",

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify(
          payload
        ),
    }
  );
}

test(
  "Facebook ingestion creates one image source and queues it once",
  async () => {
    const store =
      createMemoryStore();

    const archive =
      makeArchive();

    const messages = [];

    const env = {
      FACEBOOK_INGEST_SECRET:
        "test-secret",

      QUEUE_DAILY_SOFT_LIMIT:
        "7000",

      INGESTION_QUEUE: {
        send:
          async (body) =>
            messages.push(
              body
            ),
      },
    };

    const {
      payload,
    } =
      await makePayload();

    const first =
      await handleMoreFacebookIngest(
        makeRequest(
          payload
        ),
        env,
        store,
        archive
      );

    assert.equal(
      first.status,
      201
    );

    const firstBody =
      await first.json();

    assert.equal(
      firstBody.status,
      "NEW"
    );

    assert.equal(
      firstBody.imageSources
        .length,
      1
    );

    assert.equal(
      firstBody.imageSources[0]
        .status,
      "QUEUED"
    );

    assert.equal(
      messages.length,
      1
    );

    assert.equal(
      store.state.sources.size,
      2
    );

    const imageSource =
      [
        ...store.state.sources
          .values(),
      ].find(
        (item) =>
          item.source_type ===
          "MORE_POWER_FACEBOOK_IMAGE"
      );

    assert.ok(
      imageSource
    );

    assert.equal(
      imageSource.processing_status,
      "QUEUED"
    );

    const second =
      await handleMoreFacebookIngest(
        makeRequest(
          payload
        ),
        env,
        store,
        archive
      );

    assert.equal(
      second.status,
      200
    );

    const secondBody =
      await second.json();

    assert.equal(
      secondBody.status,
      "UNCHANGED"
    );

    assert.equal(
      secondBody.imageSources[0]
        .status,
      "UNCHANGED"
    );

    assert.equal(
      messages.length,
      1
    );

    assert.equal(
      archive.puts.length,
      2
    );
  }
);

test(
  "unchanged parent backfills a missing Facebook image source",
  async () => {
    const store =
      createMemoryStore();

    const archive =
      makeArchive();

    const messages = [];

    const env = {
      FACEBOOK_INGEST_SECRET:
        "test-secret",

      QUEUE_DAILY_SOFT_LIMIT:
        "7000",

      INGESTION_QUEUE: {
        send:
          async (body) =>
            messages.push(
              body
            ),
      },
    };

    const {
      payload,
    } =
      await makePayload();

    const first =
      await handleMoreFacebookIngest(
        makeRequest(
          payload
        ),
        env,
        store,
        archive
      );

    const firstBody =
      await first.json();

    const imageId =
      firstBody.imageSources[0]
        .sourceItemId;

    store.state.sources.delete(
      imageId
    );

    messages.length = 0;

    const second =
      await handleMoreFacebookIngest(
        makeRequest(
          payload
        ),
        env,
        store,
        archive
      );

    const secondBody =
      await second.json();

    assert.equal(
      secondBody.status,
      "UNCHANGED"
    );

    assert.equal(
      secondBody.imageSources[0]
        .status,
      "QUEUED"
    );

    assert.equal(
      messages.length,
      1
    );

    assert.equal(
      store.state.sources.size,
      2
    );

    assert.equal(
      archive.puts.length,
      2
    );
  }
);

test(
  "Facebook image extraction is forced to review instead of publishing",
  async () => {
    const store =
      createMemoryStore();

    const extraction =
      load(
        "partial-barangay.json"
      );

    const imageBytes =
      new TextEncoder()
        .encode(
          "fake image bytes"
        );

    const imageHash =
      await sha256Hex(
        "facebook-image-revision"
      );

    const source = {
      id:
        "src_facebook_image_test",

      publisher:
        "MORE Power",

      source_type:
        "MORE_POWER_FACEBOOK_IMAGE",

      source_url:
        "https://www.facebook.com/MOREpowerIloilo/posts/pfbidReviewTest#image-01",

      external_id:
        "pfbidReviewTest:image:01",

      content_hash:
        imageHash,

      published_at:
        null,

      retrieved_at:
        now.toISOString(),

      raw_object_key:
        "sources/test/image.jpg",

      inline_content:
        null,

      processing_status:
        "QUEUED",

      current_revision:
        1,

      created_at:
        now.toISOString(),
    };

    store.state.sources.set(
      source.id,
      source
    );

    const result =
      await processSourceMessage(
        {
          sourceId:
            source.id,

          revision:
            1,
        },
        {
          env: {
            AI_DAILY_SOFT_LIMIT:
              "8000",

            AI_ESTIMATED_UNITS_PER_CALL:
              "500",

            VISION_MODEL:
              "@cf/test/vision",

            AI: {
              run:
                async () => ({
                  response:
                    extraction,
                }),
            },
          },

          store,

          archive: {
            get:
              async () =>
                imageBytes
                  .buffer,
          },

          now,
        }
      );

    assert.equal(
      result.status,
      "REVIEW_REQUIRED"
    );

    assert.equal(
      store.state.events.size,
      0
    );

    assert.equal(
      store.state.reviews.length,
      1
    );

    const candidate =
      [
        ...store.state.candidates
          .values(),
      ][0];

    assert.equal(
      candidate.validation_status,
      "REVIEW_REQUIRED"
    );

    assert.ok(
      candidate.review_reasons
        .includes(
          "FACEBOOK_SOURCE_REQUIRES_REVIEW"
        )
    );

    assert.equal(
      store.state.sources
        .get(
          source.id
        )
        .processing_status,
      "REVIEW_REQUIRED"
    );
  }
);
