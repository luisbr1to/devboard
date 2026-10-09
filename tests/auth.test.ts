import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import {
  createAuthentication,
  localAuthentication,
  localDirectory,
  localDirectoryFromEnv,
  validateToken,
} from "../src/server/auth";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("Microsoft API tokens validate signature, issuer, audience, expiry, tenant and scope", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const config = { tenantId, clientId, resourceUri: "api://test" };
  const sign = (
    payload = {},
    audience = clientId,
    issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`,
    expires = "5m",
  ) =>
    new SignJWT({
      oid: "11111111-1111-4111-8111-111111111111",
      tid: tenantId,
      scp: "access_as_user",
      name: "Verified",
      ...payload,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  assert.equal(
    (await validateToken(await sign(), config, keys)).name,
    "Verified",
  );
  for (const token of [
    await sign({}, "wrong"),
    await sign({}, clientId, "https://evil.test"),
    await sign({ tid: "wrong" }),
    await sign({ scp: "User.Read" }),
    await sign(
      {},
      clientId,
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      "-1s",
    ),
  ])
    await assert.rejects(validateToken(token, config, keys));
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(other.privateKey);
  await assert.rejects(validateToken(forged, config, keys));
});

test("local authentication uses opaque server-owned sessions and directory identities", async () => {
  const authentication = localAuthentication();
  const created = await authentication.createSession!(localDirectory[0].oid);
  assert.match(created.token, /^local_[A-Za-z0-9_-]{40,}$/);
  assert.equal(created.identity.name, localDirectory[0].name);
  assert.equal(
    (await authentication.authenticate(created.token)).oid,
    localDirectory[0].oid,
  );
  assert.deepEqual(
    (await authentication.search(created.token, "joão")).map(
      (person) => person.oid,
    ),
    [localDirectory[1].oid],
  );
  assert.equal(
    (await authentication.person(created.token, localDirectory[2].oid)).name,
    localDirectory[2].name,
  );
  await assert.rejects(authentication.authenticate(`${created.token}x`));
  await assert.rejects(
    authentication.createSession!("99999999-9999-4999-8999-999999999999"),
  );
  authentication.revokeSession!(created.token);
  await assert.rejects(authentication.authenticate(created.token));
});

test("local authentication is opt-in and rejected in production", () => {
  assert.equal(createAuthentication({}).mode, "microsoft");
  assert.equal(createAuthentication({ AUTH_MODE: "local" }).mode, "local");
  assert.throws(
    () => createAuthentication({ AUTH_MODE: "local", NODE_ENV: "production" }),
    /não pode ser usado/,
  );
  assert.throws(() => createAuthentication({ AUTH_MODE: "invalid" }));
});

test("the local directory can be replaced from the environment", () => {
  assert.equal(localDirectoryFromEnv(undefined), localDirectory);
  const value = JSON.stringify([
    { name: "Pessoa Um", email: "Um@Exemplo.test" },
    { name: "Pessoa Dois", email: "dois@exemplo.test" },
  ]);
  const people = localDirectoryFromEnv(value);
  assert.deepEqual(
    people.map((person) => person.email),
    ["um@exemplo.test", "dois@exemplo.test"],
  );
  assert.match(
    people[0].oid,
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-8[\da-f]{3}-[\da-f]{12}$/,
  );
  assert.deepEqual(localDirectoryFromEnv(value), people);
  assert.notEqual(people[0].oid, people[1].oid);
  const authentication = createAuthentication({
    AUTH_MODE: "local",
    TESTHUB_LOCAL_USERS: value,
  });
  assert.deepEqual(authentication.directory, people);
  assert.throws(() => localDirectoryFromEnv("{"), /lista JSON/);
  assert.throws(() => localDirectoryFromEnv("[]"), /não vazia/);
  assert.throws(
    () => localDirectoryFromEnv('[{"name":"Sem email"}]'),
    /name e email/,
  );
  assert.throws(
    () =>
      localDirectoryFromEnv(
        '[{"name":"A","email":"a@x.test"},{"name":"B","email":"A@x.test"}]',
      ),
    /repetidos/,
  );
});
