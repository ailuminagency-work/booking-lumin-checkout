import {createConditionalCustomerFieldPublicationReader} from './conditional-customer-field-publication-reader';
import {createBusinessProfileInitializer} from './existing-business-profile';
import {attachRequestId} from './request-id';
import {readReleaseMetadata,serveReleaseMetadata} from './release-metadata';
import {createCustomerFieldRollbackReceiptReader} from './customer-field-rollback-receipt';
import {createCustomerFieldRollback} from './customer-field-rollback';
import {createCustomerFieldVersionHistoryReader} from './customer-field-version-history';
import {createCustomerFieldInstallHealthReader} from './customer-field-install-health';
import {createPaidInstallHealthReader} from './paid-install-health';
import {createCustomerFieldPublicationReader} from './customer-field-publication-reader';
import {schedulingAuthoringEnabled,createOfferSchedulingCreator} from './owner-scheduling';
import {catalogAuthoringEnabled,createSimpleOfferCreator} from './owner-catalog';
import {businessOnboardingEnabled,createBusinessApi} from './business';
import {createPaidPublicationRollback} from './paid-publication-rollback';
import {createPaidVersionHistoryReader} from './paid-version-history-reader';
import {createPaidDraftListReader} from './paid-draft-list-reader';
import {createPaidPublicationListReader,createPaidPublicationReader} from './paid-publication-reader';
import {createCustomerConfirmation,createCustomerMockPayment} from './customer-payment';
import {createMockPaymentWriter,mockPaymentsEnabled} from './mock-payment';
import {createCustomerHoldWriter} from './customer-hold';
import {createCustomerAvailabilityReader} from './customer-availability';
import {createRentalMockPaymentWriter} from './rental-mock-payment';
import {createDraftWriter} from './draft';
import {readinessFailure} from './readiness-error';
import { createBookingConfirmation } from './confirmation';
import { createReservationWriter } from './reservation';
/**
 * @lumin/api â€” production entrypoint for the hostable Booking Lumin API service.
 *
 * Composes the framework-neutral flow HTTP BFF (`createFlowHttpServer`) over a
 * real PostgreSQL pool and REAL Supabase-JWT identity verification
 * (`createSupabaseIdentityVerifier`). This is the single hostable API service.
 *
 * This is NOT the local harness. `local.ts` (the `dev` script) uses a synthetic
 * `localIdentity` and MUST NEVER be used in production. This module refuses to
 * start unless every required secret/config value is present, and never logs or
 * echoes a secret.
 *
 * Scope: authenticated flow, reservation and confirmation routes, plus health
 * and readiness probes. Confirmation derives persisted payment evidence and
 * delegates state transitions exclusively to the atomic database authority.
 * Missing payment linkage or migration remains fail-closed.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { createAvailabilityReader,createFlowRepository,createTenantProfileReader } from "./repository";
import { createFlowHttpServer } from "./http";
import { createSupabaseIdentityVerifier } from "./supabase-auth";

/** Read a required env var or fail fast. Never prints the value. */
function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/** Parse a comma-separated origin allowlist; fail fast if none are supplied. */
function originList(name: string): readonly string[] {
  const origins = required(name)
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length === 0) throw new Error(`Environment variable ${name} must list at least one origin`);
  return Object.freeze(origins);
}

function port(): number {
  const raw = process.env.PORT ?? "8080";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("PORT must be an integer in the range 1-65535");
  }
  return value;
}

function main(): void {
  // ---- Configuration (fail fast; secrets are read, never logged) ----------
  const databaseUrl = required("DATABASE_URL");
  const projectUrl = required("SUPABASE_URL");
  // The identity verifier validates bearer tokens against Supabase's
  // /auth/v1/user endpoint using the project's anon/publishable key as the
  // `apikey`. That key is the required auth credential â€” there is no local
  // HS256/JWKS secret in this verifier. See supabase-auth.ts.
  const publicKey = required("SUPABASE_ANON_KEY");
  const ownerOrigins = originList("OWNER_ORIGINS");
  const customerOrigins = originList("CUSTOMER_ORIGINS");
  const listenPort = port();
  const releaseMetadata = readReleaseMetadata(process.env);

  // ---- Real Supabase-JWT identity verification ----------------------------
  // Constructing the verifier validates projectUrl/publicKey shape and throws
  // INVALID_AUTH_CONFIGURATION on a bad config â€” surface that as a fatal start
  // error without leaking the key.
  let verifyIdentity: (bearer: string) => Promise<{ userId: string; sessionId: string; expiresAt: string }>;
  try {
    verifyIdentity = createSupabaseIdentityVerifier({ projectUrl, publicKey });
  } catch {
    throw new Error("Invalid Supabase authentication configuration (SUPABASE_URL / SUPABASE_ANON_KEY)");
  }

  // Adapt the identity verifier to the flow server's owner-auth seam:
  // (credential) => Promise<userId | null>. A verification failure yields null
  // (401) rather than throwing; the userId is a lowercased UUID, which the flow
  // server re-validates. SQL still re-checks current tenant membership.
  const authenticateOwner = async (credential: string): Promise<string | null> => {
    try {
      const evidence = await verifyIdentity(credential);
      return evidence.userId;
    } catch {
      return null;
    }
  };

  // ---- PostgreSQL pool + fixed-RPC repository -----------------------------
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PGPOOL_MAX ?? "10"),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 8000,
  });
  pool.on("error", () => {
    // Never log connection error detail (may embed the connection string).
  });

  const flowServer = createFlowHttpServer({
    repository: createFlowRepository(pool),
    tenantProfile: createTenantProfileReader(pool),
    ...(businessOnboardingEnabled(process.env)?{businessOnboarding:true,businessCreate:createBusinessApi(pool).create,businessProfile:createBusinessApi(pool).read,businessProfileInitialize:createBusinessProfileInitializer(pool)}:{}),
    ...(catalogAuthoringEnabled(process.env)?{catalogAuthoring:true,simpleOfferCreate:createSimpleOfferCreator(pool)}:{}),
    ...(schedulingAuthoringEnabled(process.env)?{schedulingAuthoring:true,offerSchedulingCreate:createOfferSchedulingCreator(pool)}:{}),
    availability: createAvailabilityReader(pool),
    customerConfirmation: createCustomerConfirmation(pool),
    customerHold: createCustomerHoldWriter(pool),
    customerAvailability: createCustomerAvailabilityReader(pool),
    reservation: createReservationWriter(pool),
    confirmation: createBookingConfirmation(pool),
    draft: createDraftWriter(pool),
    ...(mockPaymentsEnabled(process.env)?{mockPayment:createMockPaymentWriter(pool,process.env),customerMockPayment:createCustomerMockPayment(pool,process.env),paidSimplePublication:true,paidInstallHealth:createPaidInstallHealthReader(pool,customerOrigins),customerFieldInstallHealth:createCustomerFieldInstallHealthReader(pool,customerOrigins),paidPublication:createPaidPublicationReader(pool),paidCustomerFieldPublication:createCustomerFieldPublicationReader(pool,customerOrigins),paidConditionalCustomerFieldPublication:createConditionalCustomerFieldPublicationReader(pool,customerOrigins),paidPublications:createPaidPublicationListReader(pool),paidDrafts:createPaidDraftListReader(pool),paidVersionHistory:createPaidVersionHistoryReader(pool,customerOrigins),paidCustomerFieldVersionHistory:createCustomerFieldVersionHistoryReader(pool,customerOrigins),paidRollback:createPaidPublicationRollback(pool,customerOrigins),paidCustomerFieldRollback:createCustomerFieldRollback(pool,customerOrigins),paidCustomerFieldRollbackReceipt:createCustomerFieldRollbackReceiptReader(pool,customerOrigins)}:{}),
    ...(mockPaymentsEnabled(process.env)?{rentalMockPayment:createRentalMockPaymentWriter(pool,process.env)}:{}),
    authenticateOwner,
    ownerOrigins,
    customerOrigins,
    trustProxy: true, // Behind Render's TLS-terminating proxy (non-loopback peer).
  });

  // ---- Public listening server: health/readiness + flow delegation --------
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };

  const server = createServer({ maxHeaderSize: 16384 }, (req: IncomingMessage, res: ServerResponse) => {
    attachRequestId(req, res);
    let path = "/";
    try {
      path = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      path = "/";
    }
    if (serveReleaseMetadata(req, res, path, releaseMetadata)) return;
    // Liveness: no auth, no I/O.
    if (req.method === "GET" && path === "/health") {
      send(res, 200, { status: "ok" });
      return;
    }
    // Readiness: no auth; a single bounded DB ping.
    if (req.method === "GET" && path === "/ready") {
      void pool
        .query("select 1")
        .then(() => send(res, 200, { status: "ready" }))
        .catch((error: unknown) => {
          console.warn(JSON.stringify({event: 'readiness_failed', category: readinessFailure(error)}));
          send(res, 503, { status: "unready" });
        });
      return;
    }
    // Everything else is served by the authenticated flow BFF. The flow server
    // is never `.listen()`ed itself; we drive its request handler directly.
    flowServer.emit("request", req, res);
  });
  // Mirror the flow server's socket hardening on the listening server.
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  server.listen(listenPort, "0.0.0.0", () => {
    // Keep deployment logs truthful without printing secrets or arbitrary env text.
    const environment = process.env.BOOKING_LUMIN_ENV === "staging" ? "STAGING" : process.env.BOOKING_LUMIN_ENV === "demo" ? "DEMO" : "PRODUCTION";
    console.log("@lumin/api listening on 0.0.0.0:" + listenPort + " (" + environment + "; real Supabase-JWT auth)");
  });

  // ---- Graceful shutdown ---------------------------------------------------
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`@lumin/api received ${signal}; shutting down`);
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    // Hard deadline so a hung connection cannot block the platform.
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

try {
  main();
} catch (error) {
  // Fail fast with a non-secret message.
  console.error(`@lumin/api failed to start: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
