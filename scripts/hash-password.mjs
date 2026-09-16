/*
 * Location: menu-standards-app/scripts/hash-password.mjs
 *
 * Creates the two password gate settings, on your computer only:
 * - ADMIN_PASSWORD_HASH: a fingerprint of your password (scrypt)
 * - GATE_SECRET: a new random key that signs the 7-day pass
 *
 * Run from the project folder:
 *   node scripts/hash-password.mjs
 *
 * The password is typed at a hidden prompt, never as part of the command,
 * so it is not saved in your terminal history. Nothing is written to disk.
 * Copy the two printed lines into .env.local and into Vercel.
 *
 * The fingerprint format must match src/lib/auth/password.ts:
 *   scrypt.<N>.<r>.<p>.<salt in base64url>.<key in base64url>
 */

import { randomBytes, scrypt } from "node:crypto";
import process from "node:process";

const MIN_PASSWORD_LENGTH = 20;
const MAX_PASSWORD_LENGTH = 1024;
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SECRET_LENGTH = 32;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("Run this command in an interactive terminal."));
      return;
    }

    let value = "";

    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    function onData(chunk) {
      if (chunk.startsWith("\u001b")) {
        return;
      }
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          finish(new Error("Canceled. Nothing was created."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character.charCodeAt(0) >= 0x20) {
          value += character;
        }
      }
    }

    stdout.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: 256 * COST * BLOCK_SIZE },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

async function main() {
  const password = await readHidden("New admin password (hidden as you type): ");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters. Nothing was created.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Use at most ${MAX_PASSWORD_LENGTH} characters. Nothing was created.`);
  }

  const confirmation = await readHidden("Type it again: ");
  if (confirmation !== password) {
    throw new Error("The two entries did not match. Nothing was created.");
  }

  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  const fingerprint = [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join(".");
  const gateSecret = randomBytes(SECRET_LENGTH).toString("base64url");

  process.stdout.write(
    [
      "",
      "Copy these two lines into .env.local and into Vercel:",
      "",
      `ADMIN_PASSWORD_HASH=${fingerprint}`,
      `GATE_SECRET=${gateSecret}`,
      "",
      "Then run Clear-Host to clear them from this terminal.",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exitCode = 1;
});
