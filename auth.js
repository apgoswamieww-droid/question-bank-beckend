import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { findUserByLogin as repoFindUser } from "./supabase.js";

// Dummy hash used only for timing-attack mitigation on unknown users.
const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7mS5iB9jV8kW5qXU3uRwY3nYdJzCwT.";

export function findUserByLogin(identifier) {
  const needle = String(identifier ?? "").trim();
  if (!needle || needle.length > 120) return Promise.resolve(null);
  return repoFindUser(identifier);
}

export async function verifyPassword(user, password) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compareSync(String(password ?? ""), user.passwordHash);
}

export const runDummyVerify = () => bcrypt.compareSync("dummy-password", DUMMY_HASH);

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
      issuer: config.jwt.issuer,
    }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
    });
  } catch {
    return null;
  }
}

/** Shape returned to the client — never includes passwordHash or username. */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    profileImage: user.profileImage ?? null,
    phone: user.phone ?? null,
    gender: user.gender ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    address: user.address ?? null,
    hireDate: user.hireDate ?? null,
    subject: user.subject ?? null,
    qualification: user.qualification ?? null,
  };
}
