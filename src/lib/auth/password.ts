/*
 * Location: menu-standards-app/src/lib/auth/password.ts
 *
 * Checks a password attempt against ADMIN_PASSWORD_HASH.
 *
 * The password itself is never stored. scripts/hash-password.mjs turns it
 * into a fingerprint with scrypt, a deliberately slow and memory-heavy
 * method that makes guessing expensive. Fingerprint format, separated by
 * dots because .env files treat dollar signs as variables:
 *
 *   scrypt.<N>.<r>.<p>.<salt in base64url>.<key in base64url>
 *
 * Both files normalize the password with Unicode NFKC before hashing, so
 * the same password matches no matter which keyboard typed it. The final
 * comparison takes the same time whether a guess is close or not.
 *
 * Server only: uses Node.js crypto.
 */

import { Buffer } from "node:buffer";
import { scrypt, timingSafeEqual } from "node:crypto";

import { GateConfigurationError } from "./pass";

const MAX_PASSWORD_LENGTH = 1024;

type Fingerprint = {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly salt: Buffer;
  readonly key: Buffer;
};

function parseFingerprint(stored: string): Fingerprint {
  const parts = stored.split(".");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new GateConfigurationError("ADMIN_PASSWORD_HASH is not in the expected format.");
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");

  const isPowerOfTwo = Number.isInteger(cost) && cost > 1 && (cost & (cost - 1)) === 0;
  const isValid =
    isPowerOfTwo &&
    cost >= 2 ** 14 &&
    cost <= 2 ** 17 &&
    Number.isInteger(blockSize) &&
    blockSize >= 1 &&
    blockSize <= 16 &&
    Number.isInteger(parallelization) &&
    parallelization >= 1 &&
    parallelization <= 4 &&
    salt.length >= 16 &&
    key.length >= 32 &&
    key.length <= 128;

  if (!isValid) {
    throw new GateConfigurationError("ADMIN_PASSWORD_HASH has settings outside the accepted range.");
  }

  return { cost, blockSize, parallelization, salt, key };
}

function deriveKey(password: string, fingerprint: Fingerprint): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      fingerprint.salt,
      fingerprint.key.length,
      {
        N: fingerprint.cost,
        r: fingerprint.blockSize,
        p: fingerprint.parallelization,
        maxmem: 256 * fingerprint.cost * fingerprint.blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

/**
 * Returns true only if the attempt matches the admin password.
 * Throws GateConfigurationError if the fingerprint setting is missing or
 * malformed, so a setup problem is never mistaken for a wrong password.
 */
export async function verifyAdminPassword(attempt: string): Promise<boolean> {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored) {
    throw new GateConfigurationError("ADMIN_PASSWORD_HASH is missing.");
  }
  const fingerprint = parseFingerprint(stored);

  // Empty or oversized attempts still do the full work, so every wrong
  // answer takes the same amount of time.
  const isUsable = attempt.length > 0 && attempt.length <= MAX_PASSWORD_LENGTH;
  const derived = await deriveKey(isUsable ? attempt : "unusable attempt", fingerprint);

  return isUsable && timingSafeEqual(derived, fingerprint.key);
}