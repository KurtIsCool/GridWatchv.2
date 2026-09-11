import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const FACEBOOK_URL =
  "https://www.facebook.com/MOREpowerIloilo";

const DOWNLOAD_ROOT = path.resolve("facebook-downloads");

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MAX_POSTS = 5;

console.log("Starting MORE Power Facebook scraper...");

let browser = null;

/* =========================================================
 * HASHING
 * ========================================================= */

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

/* =========================================================
 * FACEBOOK URL NORMALIZATION
 * ========================================================= */

function cleanFacebookUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    /*
     * Remove Facebook tracking parameters such as:
     *
     * ?__cft__=...
     * &__tn__=...
     */
    return `${url.origin}${url.pathname}`.replace(
      /\/$/,
      ""
    );
  } catch {
    return rawUrl;
  }
}

/*
 * Extract:
 *
 * pfbidXXXXXXXX
 *
 * from:
 *
 * facebook.com/MOREpowerIloilo/posts/pfbidXXXXXXXX
 */
function extractExternalId(postUrl) {
  if (!postUrl) {
    return null;
  }

  const match = postUrl.match(
    /\/posts\/([^/?]+)/
  );

  return match?.[1] || null;
}

/* =========================================================
 * CAPTION HANDLING
 * ========================================================= */

function cleanCaption(text) {
  if (!text) {
    return null;
  }

  return text
    .replace(/\s*See less\s*$/i, "")
    .trim();
}

/*
 * Detect when Facebook gave us only part of a caption.
 */
function isCaptionTruncated(caption) {
  if (!caption) {
    return false;
  }

  const text = caption.trim();

  return (
    /\bSee more\s*$/i.test(text) ||
    /…\s*See more\s*$/i.test(text) ||
    /\.\.\.\s*See more\s*$/i.test(text)
  );
}

/* =========================================================
 * FACEBOOK MEDIA IDENTITY
 * ========================================================= */

/*
 * Facebook CDN URLs look like:
 *
 * https://scontent.filo1-1.fna.fbcdn.net/v/.../123_n.png?...tokens...
 *
 * The hostname and query string may change.
 *
 * The pathname is much more stable:
 *
 * /v/.../123_n.png
 */
function normalizeMediaIdentity(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    return url.pathname;
  } catch {
    return rawUrl;
  }
}

/*
 * Remove duplicate media items even if Facebook served the
 * same image from different CDN hosts or with different
 * temporary query parameters.
 */
function deduplicateMedia(media) {
  const seen = new Set();

  const result = [];

  for (const item of media) {
    const identity =
      normalizeMediaIdentity(
        item.originalUrl
      );

    if (!identity) {
      continue;
    }

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);

    result.push({
      ...item,
      mediaIdentity: identity,
    });
  }

  return result;
}

/* =========================================================
 * FILE UTILITIES
 * ========================================================= */

async function fileExists(filename) {
  try {
    await fs.access(filename);

    return true;
  } catch {
    return false;
  }
}

/*
 * Load the previously saved version of a Facebook post.
 */
async function loadPreviousPost(externalId) {
  if (!externalId) {
    return null;
  }

  const postJsonPath =
    path.join(
      DOWNLOAD_ROOT,
      externalId,
      "post.json"
    );

  try {
    const raw =
      await fs.readFile(
        postJsonPath,
        "utf8"
      );

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* =========================================================
 * IMAGE FILE EXTENSIONS
 * ========================================================= */

function extensionForMimeType(mimeType) {
  const cleanType =
    mimeType
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();

  switch (cleanType) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    case "image/gif":
      return "gif";

    case "image/avif":
      return "avif";

    default:
      return "bin";
  }
}

/* =========================================================
 * LOGIN POPUP
 * ========================================================= */

async function closeLoginPopup(page) {
  const selectors = [
    'div[role="dialog"] [aria-label="Close"]',

    'div[role="dialog"] div[role="button"][aria-label="Close"]',

    'div[role="dialog"] button[aria-label="Close"]',

    '[aria-label="Close"][role="button"]',
  ];

  for (const selector of selectors) {
    try {
      const button =
        page.locator(selector).first();

      if (
        await button.isVisible({
          timeout: 700,
        })
      ) {
        await button.click({
          timeout: 3000,
        });

        console.log(
          "Facebook login popup closed."
        );

        await page.waitForTimeout(500);

        return true;
      }
    } catch {
      // Try the next selector.
    }
  }

  return false;
}

/* =========================================================
 * SEE MORE
 * ========================================================= */

async function expandSeeMore(page) {
  console.log(
    'Looking for "See more" buttons...'
  );

  const articles =
    page.locator('div[role="article"]');

  const count =
    await articles.count();

  let expanded = 0;

  for (let i = 0; i < count; i++) {
    const article =
      articles.nth(i);

    try {
      const button =
        article
          .getByText(
            "See more",
            {
              exact: true,
            }
          )
          .first();

      if (
        await button.isVisible({
          timeout: 400,
        })
      ) {
        await button.click({
          timeout: 2000,
        });

        expanded++;

        await page.waitForTimeout(
          350
        );

        /*
         * Facebook sometimes shows the login
         * popup again after clicking See more.
         */
        await closeLoginPopup(
          page
        );
      }
    } catch {
      /*
       * Not fatal.
       *
       * Some See more buttons cannot be expanded
       * while logged out.
       */
    }
  }

  console.log(
    `Expanded ${expanded} post(s).`
  );
}

/* =========================================================
 * MEDIA COMPARISON
 * ========================================================= */

function createMediaFingerprint(media) {
  const identities =
    (media || [])
      .map(
        (item) =>
          normalizeMediaIdentity(
            item.originalUrl
          )
      )
      .filter(Boolean)
      .sort();

  return sha256(
    Buffer.from(
      JSON.stringify(
        identities
      ),
      "utf8"
    )
  );
}

/* =========================================================
 * FINAL REVISION HASH
 * ========================================================= */

/*
 * IMPORTANT:
 *
 * Do NOT include:
 *
 * "2h"
 * "13h"
 * "1d"
 *
 * because Facebook changes those automatically.
 */
function createRevisionHash(post) {
  const material = {
    externalId:
      post.externalId,

    caption:
      post.caption,

    media:
      (post.media || []).map(
        (media) => ({
          sha256:
            media.sha256 ||
            null,
        })
      ),
  };

  return sha256(
    Buffer.from(
      JSON.stringify(
        material
      ),
      "utf8"
    )
  );
}

/* =========================================================
 * IMAGE DOWNLOADER
 * ========================================================= */

async function downloadImage({
  request,
  imageUrl,
  postDirectory,
  imageNumber,
}) {
  console.log(
    `  Downloading image ${imageNumber}...`
  );

  const response =
    await request.get(
      imageUrl,
      {
        headers: {
          Referer:
            FACEBOOK_URL,
        },

        timeout:
          30000,
      }
    );

  if (!response.ok()) {
    throw new Error(
      `HTTP ${response.status()}`
    );
  }

  const mimeType =
    response
      .headers()
      ["content-type"]
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase() ||
    "application/octet-stream";

  if (
    !mimeType.startsWith(
      "image/"
    )
  ) {
    throw new Error(
      `Unexpected MIME type: ${mimeType}`
    );
  }

  const buffer =
    await response.body();

  if (
    buffer.length >
    MAX_IMAGE_BYTES
  ) {
    throw new Error(
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`
    );
  }

  const imageHash =
    sha256(buffer);

  const extension =
    extensionForMimeType(
      mimeType
    );

  const filename =
    `image-${String(
      imageNumber
    ).padStart(
      2,
      "0"
    )}.${extension}`;

  const filePath =
    path.join(
      postDirectory,
      filename
    );

  await fs.writeFile(
    filePath,
    buffer
  );

  console.log(
    `    Saved: ${filename}`
  );

  console.log(
    `    Size: ${buffer.length} bytes`
  );

  console.log(
    `    SHA-256: ${imageHash}`
  );

  return {
    filename,
    mimeType,
    bytes:
      buffer.length,
    sha256:
      imageHash,
  };
}

/* =========================================================
 * MAIN
 * ========================================================= */

try {
  console.log(
    "Launching your installed Google Chrome..."
  );

 const isCI = process.env.CI === "true";

browser = await chromium.launch({
  // On your Windows PC, use installed Google Chrome.
  // On GitHub Actions, use Playwright's Chromium.
  ...(isCI
    ? {}
    : { channel: "chrome" }),

  headless: isCI,
});

  const context =
    await browser.newContext({
      viewport: {
        width:
          1440,

        height:
          1200,
      },

      locale:
        "en-US",
    });

  const page =
    await context.newPage();

  console.log(
    "Opening Facebook..."
  );

  await page.goto(
    FACEBOOK_URL,
    {
      waitUntil:
        "domcontentloaded",

      timeout:
        60000,
    }
  );

  console.log(
    "Waiting for Facebook to render..."
  );

  await page.waitForTimeout(
    8000
  );

  console.log(
    "Page title:",
    await page.title()
  );

  console.log(
    "Current URL:",
    page.url()
  );

  /*
   * Remove login overlay if Facebook
   * provides a Close button.
   */
  await closeLoginPopup(
    page
  );

  /*
   * Try to obtain full captions.
   */
  await expandSeeMore(
    page
  );

  await page.waitForTimeout(
    1200
  );

  const articleCount =
    await page
      .locator(
        'div[role="article"]'
      )
      .count();

  console.log(
    `Found ${articleCount} article elements.`
  );

  /* =======================================================
   * RAW DOM EXTRACTION
   * ======================================================= */

  const rawArticles =
    await page
      .locator(
        'div[role="article"]'
      )
      .evaluateAll(
        (articles) => {
          return articles.map(
            (
              article,
              articleIndex
            ) => {
              /* -----------------------
               * CAPTION
               * ----------------------- */

              const messageElement =
                article.querySelector(
                  '[data-ad-preview="message"]'
                ) ||
                article.querySelector(
                  '[data-ad-comet-preview="message"]'
                );

              const text =
                messageElement
                  ?.innerText
                  ?.trim() ||
                "";

              /* -----------------------
               * LINKS
               * ----------------------- */

              const links = [
                ...article.querySelectorAll(
                  "a[href]"
                ),
              ]
                .map(
                  (element) => ({
                    url:
                      element.href ||
                      element.getAttribute(
                        "href"
                      ) ||
                      "",

                    text:
                      element
                        .innerText
                        ?.trim() ||
                      "",

                    title:
                      element.getAttribute(
                        "title"
                      ) ||
                      "",

                    ariaLabel:
                      element.getAttribute(
                        "aria-label"
                      ) ||
                      "",
                  })
                )
                .filter(
                  (item) =>
                    item.url
                );

              /*
               * Real MORE Power post.
               *
               * Comments may also contain /posts/
               * URLs, so comment_id must be excluded.
               */
              const postLink =
                links.find(
                  ({ url }) =>
                    url.includes(
                      "/MOREpowerIloilo/posts/"
                    ) &&
                    !url.includes(
                      "comment_id="
                    )
                ) ||
                null;

              /* -----------------------
               * TIMESTAMP
               * ----------------------- */

              let timestampText =
                postLink
                  ?.text ||
                null;

              let timestampTitle =
                postLink
                  ?.title ||
                null;

              let timestampAriaLabel =
                postLink
                  ?.ariaLabel ||
                null;

              const timeElement =
                article.querySelector(
                  "time"
                );

              if (
                timeElement
              ) {
                timestampText =
                  timestampText ||
                  timeElement
                    .textContent
                    ?.trim() ||
                  null;

                timestampTitle =
                  timestampTitle ||
                  timeElement.getAttribute(
                    "datetime"
                  ) ||
                  timeElement.getAttribute(
                    "title"
                  ) ||
                  null;

                timestampAriaLabel =
                  timestampAriaLabel ||
                  timeElement.getAttribute(
                    "aria-label"
                  ) ||
                  null;
              }

              /* -----------------------
               * IMAGES
               * ----------------------- */

              const images = [
                ...article.querySelectorAll(
                  "img"
                ),
              ]
                .map(
                  (img) => ({
                    url:
                      img.currentSrc ||
                      img.src ||
                      "",

                    alt:
                      img.alt ||
                      "",

                    width:
                      img.naturalWidth ||
                      img.width ||
                      0,

                    height:
                      img.naturalHeight ||
                      img.height ||
                      0,
                  })
                )
                .filter(
                  (image) => {
                    if (
                      !image.url
                    ) {
                      return false;
                    }

                    const isFacebookCdn =
                      image.url.includes(
                        "scontent"
                      ) ||
                      image.url.includes(
                        "fbcdn"
                      );

                    if (
                      !isFacebookCdn
                    ) {
                      return false;
                    }

                    /*
                     * Filter most:
                     *
                     * avatars
                     * icons
                     * reactions
                     * tiny UI images
                     */
                    return (
                      image.width >=
                        200 &&
                      image.height >=
                        200
                    );
                  }
                );

              return {
                articleIndex,

                text,

                postUrl:
                  postLink
                    ?.url ||
                  null,

                timestampText,

                timestampTitle,

                timestampAriaLabel,

                images,
              };
            }
          );
        }
      );

  /* =======================================================
   * NORMALIZE REAL POSTS
   * ======================================================= */

  let posts =
    rawArticles
      .filter(
        (article) => {
          if (
            !article.postUrl
          ) {
            return false;
          }

          if (
            article.postUrl.includes(
              "comment_id="
            )
          ) {
            return false;
          }

          if (
            !article.postUrl.includes(
              "/MOREpowerIloilo/posts/"
            )
          ) {
            return false;
          }

          return (
            Boolean(
              article.text
            ) ||
            article.images.length >
              0
          );
        }
      )
      .map(
        (article) => {
          const url =
            cleanFacebookUrl(
              article.postUrl
            );

          return {
            source:
              "MORE_POWER_FACEBOOK",

            externalId:
              extractExternalId(
                url
              ),

            url,

            caption:
              cleanCaption(
                article.text
              ),

            /*
             * This is observational only.
             *
             * "2h" must never be used to determine
             * whether a post changed.
             */
            published: {
              text:
                article.timestampText,

              title:
                article.timestampTitle,

              ariaLabel:
                article.timestampAriaLabel,
            },

            media:
              deduplicateMedia(
                article.images.map(
                  (
                    image
                  ) => ({
                    originalUrl:
                      image.url,

                    alt:
                      image.alt,

                    width:
                      image.width,

                    height:
                      image.height,
                  })
                )
              ),

            observedAt:
              new Date()
                .toISOString(),
          };
        }
      );

  /*
   * Remove duplicate DOM representations
   * of the same Facebook post.
   */
  posts =
    posts.filter(
      (
        post,
        index,
        array
      ) =>
        Boolean(
          post.externalId
        ) &&
        index ===
          array.findIndex(
            (
              candidate
            ) =>
              candidate.externalId ===
              post.externalId
          )
    );

  posts =
    posts.slice(
      0,
      MAX_POSTS
    );

  console.log("");
  console.log(
    "=============================="
  );

  console.log(
    "MORE POWER FACEBOOK POSTS"
  );

  console.log(
    "=============================="
  );

  console.log(
    `Actual posts detected: ${posts.length}`
  );

  await fs.mkdir(
    DOWNLOAD_ROOT,
    {
      recursive:
        true,
    }
  );

  const runResults = [];

  /* =======================================================
   * COMPARE EACH POST WITH PREVIOUSLY SAVED VERSION
   * ======================================================= */

  for (
    const scrapedPost of posts
  ) {
    let post = {
      ...scrapedPost,
    };

    const previous =
      await loadPreviousPost(
        post.externalId
      );

    console.log("");

    /* -----------------------------------------------------
     * NEW POST
     * ----------------------------------------------------- */

    if (!previous) {
      console.log(
        `NEW: ${post.externalId}`
      );
    }

    /*
     * Facebook's public feed is not deterministic.
     *
     * Sometimes a previously full caption is returned
     * truncated during the next scrape.
     *
     * Empty/truncated data is NOT evidence that MORE
     * Power edited the post.
     */

    if (previous) {
      const currentTruncated =
        isCaptionTruncated(
          post.caption
        );

      const previousTruncated =
        isCaptionTruncated(
          previous.caption
        );

      /*
       * If current scrape lost the caption entirely,
       * preserve our previous evidence.
       */
      if (
        !post.caption &&
        previous.caption
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );

        console.log(
          "  Current caption missing; preserving previous caption."
        );

        post.caption =
          previous.caption;
      }

      /*
       * Current Facebook scrape is truncated,
       * but previous capture was complete.
       *
       * Keep the better evidence.
       */
      else if (
        currentTruncated &&
        !previousTruncated
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );

        console.log(
          "  Current caption truncated; preserving previous full caption."
        );

        post.caption =
          previous.caption;
      }

      /*
       * If Facebook temporarily fails to render images,
       * don't interpret that as MORE Power deleting them.
       */
      if (
        post.media.length ===
          0 &&
        Array.isArray(
          previous.media
        ) &&
        previous.media.length >
          0
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );

        console.log(
          "  Current media missing; preserving previous media."
        );

        post.media =
          previous.media.map(
            (media) => ({
              ...media,

              /*
               * Keep a normalized identity available.
               */
              mediaIdentity:
                normalizeMediaIdentity(
                  media.originalUrl
                ),
            })
          );
      }
    }

    /* -----------------------------------------------------
     * DETERMINE WHETHER EVIDENCE CHANGED
     * ----------------------------------------------------- */

    let captionChanged =
      false;

    let mediaChanged =
      false;

    if (previous) {
      captionChanged =
        (post.caption || "") !==
        (previous.caption || "");

      const currentMediaFingerprint =
        createMediaFingerprint(
          post.media
        );

      const previousMediaFingerprint =
        createMediaFingerprint(
          previous.media ||
            []
        );

      mediaChanged =
        currentMediaFingerprint !==
        previousMediaFingerprint;
    }

    /* -----------------------------------------------------
     * UNCHANGED
     * ----------------------------------------------------- */

    if (
      previous &&
      !captionChanged &&
      !mediaChanged
    ) {
      console.log(
        `UNCHANGED: ${post.externalId}`
      );

      console.log(
        "  Caption/media unchanged."
      );

      console.log(
        "  Skipping image downloads."
      );

      runResults.push({
        externalId:
          post.externalId,

        url:
          post.url,

        result:
          "UNCHANGED",

        revisionSha256:
          previous.revisionSha256 ||
          null,

        observedAt:
          post.observedAt,
      });

      continue;
    }

    /* -----------------------------------------------------
     * UPDATED
     * ----------------------------------------------------- */

    if (previous) {
      console.log(
        `UPDATED: ${post.externalId}`
      );

      console.log(
        `  Caption changed: ${captionChanged}`
      );

      console.log(
        `  Media changed: ${mediaChanged}`
      );
    }

    /* =====================================================
     * DOWNLOAD NEW/UPDATED EVIDENCE
     * ===================================================== */

    const postDirectory =
      path.join(
        DOWNLOAD_ROOT,
        post.externalId
      );

    await fs.mkdir(
      postDirectory,
      {
        recursive:
          true,
      }
    );

    const downloadedMedia =
      [];

    console.log(
      `  Images: ${post.media.length}`
    );

    for (
      let i = 0;
      i < post.media.length;
      i++
    ) {
      const media =
        post.media[i];

      /*
       * If media came from previous evidence because the
       * current Facebook scrape did not render images,
       * preserve it instead of attempting an unnecessary
       * download.
       */
      if (
        media.sha256 &&
        media.filename &&
        !media.downloadError &&
        post.media ===
          previous?.media
      ) {
        downloadedMedia.push(
          media
        );

        continue;
      }

      try {
        const downloaded =
          await downloadImage({
            request:
              context.request,

            imageUrl:
              media.originalUrl,

            postDirectory,

            imageNumber:
              i + 1,
          });

        downloadedMedia.push({
          originalUrl:
            media.originalUrl,

          mediaIdentity:
            normalizeMediaIdentity(
              media.originalUrl
            ),

          alt:
            media.alt ||
            "",

          width:
            media.width ||
            0,

          height:
            media.height ||
            0,

          ...downloaded,
        });
      } catch (error) {
        console.error(
          `  Failed to download image ${i + 1}: ${error.message}`
        );

        /*
         * If this image existed in our previous version,
         * preserve its downloaded evidence.
         */
        const oldMedia =
          previous?.media?.find(
            (
              candidate
            ) =>
              normalizeMediaIdentity(
                candidate.originalUrl
              ) ===
              normalizeMediaIdentity(
                media.originalUrl
              )
          );

        if (
          oldMedia?.sha256
        ) {
          console.log(
            "  Preserving previously downloaded copy."
          );

          downloadedMedia.push({
            ...oldMedia,

            originalUrl:
              media.originalUrl,
          });

          continue;
        }

        downloadedMedia.push({
          ...media,

          mediaIdentity:
            normalizeMediaIdentity(
              media.originalUrl
            ),

          downloadError:
            error.message,
        });
      }
    }

    post.media =
      downloadedMedia;

    /* =====================================================
     * REVISION HASH
     * ===================================================== */

    post.revisionSha256 =
      createRevisionHash(
        post
      );

    post.savedAt =
      new Date()
        .toISOString();

    /*
     * We deliberately do not include Facebook's
     * relative "2h" timestamp in revisionSha256.
     */

    const postJsonPath =
      path.join(
        postDirectory,
        "post.json"
      );

    await fs.writeFile(
      postJsonPath,
      JSON.stringify(
        post,
        null,
        2
      ),
      "utf8"
    );

    const result =
      previous
        ? "UPDATED"
        : "NEW";

    console.log(
      `  Revision SHA-256: ${post.revisionSha256}`
    );

    console.log(
      `  Saved metadata: ${postJsonPath}`
    );

    runResults.push({
      externalId:
        post.externalId,

      url:
        post.url,

      result,

      revisionSha256:
        post.revisionSha256,

      observedAt:
        post.observedAt,
    });
  }

  /* =======================================================
   * RUN SUMMARY
   * ======================================================= */

  const summary = {
    source:
      "MORE_POWER_FACEBOOK",

    sourceUrl:
      FACEBOOK_URL,

    checkedAt:
      new Date()
        .toISOString(),

    detected:
      posts.length,

    new:
      runResults.filter(
        (item) =>
          item.result ===
          "NEW"
      ).length,

    updated:
      runResults.filter(
        (item) =>
          item.result ===
          "UPDATED"
      ).length,

    unchanged:
      runResults.filter(
        (item) =>
          item.result ===
          "UNCHANGED"
      ).length,

    posts:
      runResults,
  };

  await fs.writeFile(
    path.join(
      DOWNLOAD_ROOT,
      "index.json"
    ),
    JSON.stringify(
      summary,
      null,
      2
    ),
    "utf8"
  );

  /* =======================================================
   * DEBUG FILE
   * ======================================================= */

  await fs.writeFile(
    path.join(
      DOWNLOAD_ROOT,
      "debug-articles.json"
    ),
    JSON.stringify(
      rawArticles,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    "=============================="
  );

  console.log(
    "RUN SUMMARY"
  );

  console.log(
    "=============================="
  );

  console.log(
    `DETECTED:  ${summary.detected}`
  );

  console.log(
    `NEW:       ${summary.new}`
  );

  console.log(
    `UPDATED:   ${summary.updated}`
  );

  console.log(
    `UNCHANGED: ${summary.unchanged}`
  );

  console.log("");

  console.log(
    `Saved to: ${DOWNLOAD_ROOT}`
  );

  console.log("");

  console.log(
    "Keeping browser open for 5 seconds..."
  );

  await page.waitForTimeout(
    5000
  );
} catch (error) {
  console.error("");

  console.error(
    "=============================="
  );

  console.error(
    "SCRAPER FAILED"
  );

  console.error(
    "=============================="
  );

  console.error(error);

  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}