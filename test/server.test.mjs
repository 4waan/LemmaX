import test from "node:test";
import assert from "node:assert/strict";
import { visitorAddress } from "../web/server.mjs";

test("Direct visitors cannot choose their rate-limit identity with a forwarded header", () => {
  const request = { socket: { remoteAddress: "192.0.2.1" }, headers: { "x-forwarded-for": "203.0.113.1" } };
  assert.equal(visitorAddress(request), "192.0.2.1");
  request.headers["x-forwarded-for"] = "203.0.113.2";
  assert.equal(visitorAddress(request), "192.0.2.1");
  assert.equal(visitorAddress(request, { trustProxy: false }), "192.0.2.1");
});

test("Forwarded addresses require trusted-proxy opt-in and fall back to the socket when empty", () => {
  const request = { socket: { remoteAddress: "192.0.2.1" }, headers: { "x-forwarded-for": " 203.0.113.1, 192.0.2.2" } };
  assert.equal(visitorAddress(request, { trustProxy: true }), "203.0.113.1");
  request.headers["x-forwarded-for"] = " ";
  assert.equal(visitorAddress(request, { trustProxy: true }), "192.0.2.1");
  delete request.headers["x-forwarded-for"];
  assert.equal(visitorAddress(request, { trustProxy: true }), "192.0.2.1");
});
