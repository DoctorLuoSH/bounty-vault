'use strict';

/** Shared input validators for the REST API (docs/ARCHITECTURE.md section 3.2). */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const isAddress = (v) => typeof v === 'string' && ADDRESS_RE.test(v);
const isTxHash = (v) => typeof v === 'string' && TX_HASH_RE.test(v);
const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
const isNonEmptyString = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

module.exports = { isAddress, isTxHash, isNonNegativeInt, isNonEmptyString };
